/**
 * ジョブ本体の実処理（サーバ専用）。
 *
 * app/api/jobs の POST が after() からこの runJob を呼ぶ。生成→ドメイン保存→
 * jobs 行の更新まで行い、クライアント接続とは独立して完走する。
 * 既存の生成ロジック（runAnalyzeStep / runPipelineParallel / streamPrototypeHtml 等）を
 * そのまま再利用する。
 */
import { extractHtmlFromText } from "@/lib/api-client";
import {
  DEFAULT_PROVIDER,
  FAST_MODEL,
  type LlmProvider,
} from "@/lib/ai/catalog";
import { generateDeck } from "@/lib/ai/deck";
import { runPipelineParallel, STEP_ROLES } from "@/lib/ai/pipeline";
import {
  buildDeckContext,
  buildDesignBriefContext,
  buildEngineerBriefContext,
  buildRefinePrototypeContext,
} from "@/lib/ai/project-context";
import { regenerateNavigationFromModeling } from "@/lib/ai/regenerate-navigation";
import { isStepKey, runAnalyzeStep } from "@/lib/ai/run-step";
import { generateDesignBrief, generateEngineerBrief } from "@/lib/ai/steps";
import {
  continuePrototypeHtml,
  generatePrototypeHtml,
  realizePrototypeHtml,
  streamPrototypeHtml,
  streamUpdatePrototypeHtml,
} from "@/lib/prototype-html";
import { parseScreenNames } from "@/lib/prototype-screens";
import { generateScreenComponent } from "@/lib/prototype-ds/generate-screen";
import { generateDaisyTheme } from "@/lib/prototype-ds/generate-theme";
import { buildDsHtml } from "@/lib/prototype-ds/shell";
import {
  type DsScreenRecord,
  getProjectWithArtifacts,
  getPrototypeDsState,
  saveDeck,
  saveDesignRequest,
  saveStepResult,
  savePrototype,
  type StepKey,
} from "@/lib/projects";
import {
  completeJob,
  failJob,
  updateJobProgress,
  type JobRow,
} from "@/lib/jobs";
import { createPrototype, type PrototypeContext } from "@/lib/v0";

const TOTAL_STEPS = Object.keys(STEP_ROLES).length;

/** ジョブ種別に応じて実処理を選び、完了/失敗を jobs 行へ書き込む。 */
export async function runJob(job: JobRow): Promise<void> {
  try {
    if (job.kind === "step") {
      await runStepJob(job);
    } else if (job.kind === "orchestrate") {
      await runOrchestrateJob(job);
    } else if (job.kind === "prototype") {
      await runPrototypeJob(job);
    } else if (job.kind === "deck") {
      await runDeckJob(job);
    } else if (job.kind === "design-brief") {
      await runDesignBriefJob(job);
    } else if (job.kind === "engineer-brief") {
      await runEngineerBriefJob(job);
    } else if (job.kind === "design-refine") {
      await runDesignRefineJob(job);
    } else {
      throw new Error(`Unknown job kind: ${job.kind}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "生成に失敗しました";
    await failJob(job.id, message);
  }
}

async function runStepJob(job: JobRow): Promise<void> {
  const p = job.payload as {
    context?: string;
    provider?: LlmProvider;
    modelId?: string;
  };
  const step = job.step;
  if (!isStepKey(step)) throw new Error(`Unknown step: ${step}`);
  if (!p.context?.trim()) throw new Error("context is required");

  const result = await runAnalyzeStep({
    step,
    context: p.context,
    provider: p.provider,
    modelId: p.modelId,
  });
  await saveStepResult(job.ownerId, job.projectId, step, result);
  await completeJob(job.id, result);

  // ナビゲーションはモデリング（OOUI）から AI が自動導出する（手動工程は廃止）。
  // ジョブ完了後に走らせるため、失敗しても ooui ジョブ自体は成功のまま扱う。
  if (step === "ooui") {
    try {
      await regenerateNavigationFromModeling({
        ownerId: job.ownerId,
        projectId: job.projectId,
        provider: p.provider,
        modelId: p.modelId,
      });
    } catch (e) {
      console.error("navigation auto-regeneration failed:", e);
    }
  }
}

async function runOrchestrateJob(job: JobRow): Promise<void> {
  const p = job.payload as {
    provider?: LlmProvider;
    modelId?: string;
    modelByStep?: Partial<
      Record<StepKey, { provider?: LlmProvider; modelId?: string }>
    >;
  };

  const artifacts = await getProjectWithArtifacts(job.ownerId, job.projectId);
  if (!artifacts) throw new Error("Project not found");

  const baseContext = [
    `# プロジェクト: ${artifacts.project.name}`,
    artifacts.project.summary && `## 概要\n${artifacts.project.summary}`,
    artifacts.detail && `## 入力資料\n${artifacts.detail}`,
    artifacts.analysisResult && `## ジョブ分析\n${artifacts.analysisResult}`,
    artifacts.sourceText && `## 参考資料\n${artifacts.sourceText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const done: string[] = [];
  await updateJobProgress(job.id, { doneSteps: done, totalSteps: TOTAL_STEPS });

  const results = await runPipelineParallel({
    baseContext,
    provider: p.provider,
    modelId: p.modelId,
    modelByStep: p.modelByStep,
    onStepDone: async (step, result) => {
      await saveStepResult(
        job.ownerId,
        job.projectId,
        step,
        result as Parameters<typeof saveStepResult>[3],
      );
      done.push(step);
      await updateJobProgress(job.id, {
        doneSteps: [...done],
        totalSteps: TOTAL_STEPS,
      });
    },
  });

  await completeJob(
    job.id,
    { results, roles: STEP_ROLES },
    { doneSteps: done, totalSteps: TOTAL_STEPS },
  );
}

interface PrototypePayload extends PrototypeContext {
  provider?: LlmProvider;
  modelId?: string;
  engine?: "v0" | "aws" | "ds";
  mode?: "create" | "update" | "realize" | "continue";
  instruction?: string;
  currentHtml?: string;
  /** DS画面/テーマ生成に基準モデル（高品質・低速）を使う。未指定/false なら高速モデル。 */
  dsUseBaseModel?: boolean;
}

async function runPrototypeJob(job: JobRow): Promise<void> {
  const p = job.payload as unknown as PrototypePayload;
  const mode = p.mode ?? "create";

  // 構造化生成（DSエンジン）: 骨格はコード、画面ごとに React コンポーネントを並列生成して
  // 組み立てる。単一HTMLの一括生成と違い構造が崩れない・途中切れしない。
  if (p.engine === "ds") {
    await runDsPrototypeJob(job, p);
    return;
  }

  // 継続生成: 途中切れHTMLの「続き」だけを生成して連結し、</html> まで完成させる
  // （切れていた末尾スクリプト＝navigate() 等を補完して遷移を復活させる）。
  if (mode === "continue" && p.currentHtml?.trim()) {
    const base = p.currentHtml;
    const cstream = continuePrototypeHtml(base, p.provider, p.modelId);
    let cont = "";
    let last = 0;
    for await (const delta of cstream.textStream) {
      cont += delta;
      if (base.length + cont.length - last >= 3000) {
        last = base.length + cont.length;
        await updateJobProgress(job.id, { chars: base.length + cont.length });
      }
    }
    const finishReason = await cstream.finishReason;
    // 続きは生フラグメント。先頭のフェンス/前置きを除去して素直に連結する。
    const tail = cont.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
    const combined = (base + tail).trim();
    // まだ </html> で終わっていない or length 切れなら継続中（もう一度押せる）。
    const truncated =
      finishReason === "length" || !/<\/html>\s*$/i.test(combined);
    const screens = parseScreenNames(combined);
    await savePrototype(job.ownerId, job.projectId, { html: combined });
    await completeJob(
      job.id,
      { html: combined, truncated },
      { chars: combined.length, screens, truncated },
    );
    return;
  }

  const stream =
    mode === "update" && p.currentHtml?.trim()
      ? streamUpdatePrototypeHtml(
          p.currentHtml,
          p.instruction ?? "",
          p.provider,
          p.modelId,
        )
      : mode === "realize" && p.currentHtml?.trim()
        ? realizePrototypeHtml(p.currentHtml, p.provider, p.modelId)
        : streamPrototypeHtml(p, p.provider, p.modelId);

  // ストリームを最後まで読み、進捗を間引いて更新する。
  // client は progress.chars（受信文字数）と progress.screens（生成できた画面名）を見る。
  // 画面マーカー（<!-- @screen:... -->）は保存 HTML にも残し、生成後の画面一覧にも使う。
  let acc = "";
  let lastReported = 0;
  let lastScreenCount = 0;
  for await (const delta of stream.textStream) {
    acc += delta;
    const screens = parseScreenNames(acc);
    // 文字数が一定増えた時、または新しい画面が現れた時に進捗を流す。
    if (acc.length - lastReported >= 3000 || screens.length > lastScreenCount) {
      lastReported = acc.length;
      lastScreenCount = screens.length;
      await updateJobProgress(job.id, { chars: acc.length, screens });
    }
  }

  // 出力トークン上限に達して途中で切れたか（finishReason==="length"）を検知する。
  // 切れていても部分 HTML は保存し、client に truncated を伝えて明示する（無言の部分生成を防ぐ）。
  const finishReason = await stream.finishReason;
  const truncated = finishReason === "length";

  const html = extractHtmlFromText(acc);
  const screens = parseScreenNames(html);
  await savePrototype(job.ownerId, job.projectId, { html });
  await completeJob(
    job.id,
    { html, truncated },
    { chars: html.length, screens, truncated },
  );
}

/** DSエンジン: 選択画面ごとに React コンポーネントを並列生成し、コードの骨格に
 *  差し込んで単一HTMLを組み立てる（構造が崩れない・途中切れしない）。 */
async function runDsPrototypeJob(
  job: JobRow,
  p: PrototypePayload,
): Promise<void> {
  // メニュー全項目（親子・順序つき）。
  const allNav: {
    label: string;
    parent?: string | null;
    icon?: string | null;
    screenType?: string | null;
    targetObject?: string | null;
  }[] =
    p.navigation && p.navigation.length
      ? p.navigation
      : [{ label: p.projectName || "ホーム" }];

  // 親(=他項目の parent になっている label)はグループ見出しとして扱い、画面は生成しない。
  // これで2階層ナビが描画でき、カテゴリ親の空画面ノイズも出ない。
  const parentLabels = new Set(
    allNav.map((n) => n.parent).filter((x): x is string => !!x),
  );
  const leafNav = allNav.filter((n) => !parentLabels.has(n.label));
  // 念のため: すべてが親扱いになった場合は全項目をリーフとして扱う。
  const navItems = leafNav.length ? leafNav : allNav;

  // 探索プロトタイプ: MVPスコープで絞らず、全ユースケース・全画面を網羅的に作る。
  // （MVPスコープはこの探索プロトタイプを見たあとに確定する設計）。
  const baseContext = [
    `# アプリ: ${p.projectName ?? ""}${p.summary ? `：${p.summary}` : ""}`,
    p.mvpStatement ? `# 想定する提供価値(参考): ${p.mvpStatement}` : "",
    p.oouiObjects?.length
      ? `# 主要オブジェクト（データ単位）: ${p.oouiObjects
          .map(
            (o) =>
              o.name +
              (o.attributes?.length ? `（${o.attributes.join(", ")}）` : ""),
          )
          .join(" / ")}`
      : "",
    `# 方針: これは探索用プロトタイプです。MVPに絞り込まず、全ユースケース・全画面を網羅的に作成してください（取捨選択はこのプロトタイプを見てから別途行います）。`,
    p.scope?.length
      ? `# 主な機能（すべて網羅対象・取捨選択しない）: ${p.scope
          .map((f) => f.name)
          .join(" / ")}`
      : "",
    `# 全画面構成: ${navItems.map((n) => n.label).join(" / ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const total = navItems.length;

  // DSは「骨格=コード固定／各画面=小さな自己完結コンポーネント」設計なので、
  // 既定では画面・テーマ生成に高速モデル（FAST_MODEL）を使ってレイテンシを大きく下げる。
  // 構造崩れは骨格側が防ぎ、稀な生成失敗はプレースホルダ＋部分再生成で回復できる。
  // dsUseBaseModel=true のときは品質優先で基準モデル（client が選んだ p.modelId）を使う。
  const dsProvider: LlmProvider = p.provider ?? DEFAULT_PROVIDER;
  const dsModelId =
    p.dsUseBaseModel && p.modelId ? p.modelId : FAST_MODEL[dsProvider];

  // 非破壊マージ: 既存の画面別ソース＋テーマを読み、再生成しない画面はこれを再利用する。
  // 初回や AWS 由来でソース未保存なら null（その場合は全画面を生成＝破壊は起きない）。
  const prevState = await getPrototypeDsState(job.ownerId, job.projectId);
  const prev = prevState?.screens ?? null;
  const prevTheme = prevState?.theme ?? null;
  const prevByLabel = new Map<string, DsScreenRecord>();
  for (const s of prev ?? []) prevByLabel.set(s.label, s);

  // 再生成対象の集合。selectedScreens 未指定なら全再生成（null）。
  // 親が選ばれていれば配下のリーフも対象に含める（page 側の展開と同じ）。
  const selected = p.selectedScreens?.length
    ? new Set(p.selectedScreens)
    : null;
  const shouldRegen = (leaf: {
    label: string;
    parent?: string | null;
  }): boolean => {
    if (!prevByLabel.has(leaf.label)) return true; // 未保存は必ず作る（破壊しない）
    if (selected === null) return true; // 全再生成
    return (
      selected.has(leaf.label) ||
      (leaf.parent != null && selected.has(leaf.parent))
    );
  };

  // ライブ進捗には「揃っている画面」を出す。再利用ぶんは即時に表示する。
  const done: string[] = navItems
    .filter((n) => !shouldRegen(n))
    .map((n) => n.label);
  await updateJobProgress(job.id, { screens: [...done], totalScreens: total });

  // 部分再生成（一部画面のみ選択）で既存テーマがあれば、それを再利用する。
  // → 配色の一貫性を保ち、テーマ生成のLLM呼び出し（数十秒）を省いて高速化する。
  // 全再生成（selected===null）や初回・テーマ未保存なら従来どおりブランドから生成。
  const reuseTheme = selected !== null && prevTheme != null;
  const brandCtx = [
    `# アプリ: ${p.projectName ?? ""}`,
    p.brand?.brandName ? `# ブランド名: ${p.brand.brandName}` : "",
    p.brand?.tagline ? `# タグライン: ${p.brand.tagline}` : "",
    p.brand?.tone?.length ? `# トーン: ${p.brand.tone.join(" / ")}` : "",
    p.brand?.palette?.primary
      ? `# 基調色(primary): ${p.brand.palette.primary}`
      : "",
    p.brand?.palette?.accent
      ? `# アクセント: ${p.brand.palette.accent}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const themePromise = reuseTheme
    ? Promise.resolve(prevTheme)
    : p.brand?.palette?.primary
      ? generateDaisyTheme({
          context: brandCtx,
          provider: dsProvider,
          modelId: dsModelId,
        })
      : Promise.resolve(null);

  // 各リーフを「再生成 or 既存ソース再利用」で解決し、全画面の union を作る。
  // componentName は union のインデックスで採番し直す（並び替えに強い）。再利用ソースは
  // 保存時の関数名を新しい componentName に置換してから流用する。
  const [screensOut, theme] = await Promise.all([
    Promise.all(
      navItems.map(async (item, i): Promise<DsScreenRecord> => {
        const nav = item as {
          label: string;
          parent?: string | null;
          screenType?: string | null;
          targetObject?: string | null;
        };
        const componentName = `Screen${i}`;
        // 再利用: 生成済みの保存ソースを流用（関数名だけ採番に合わせる）。
        if (!shouldRegen(nav)) {
          const stored = prevByLabel.get(nav.label)!;
          return {
            label: nav.label,
            componentName,
            source: renameComponent(
              stored.source,
              stored.componentName,
              componentName,
            ),
            failed: stored.failed,
            parent: nav.parent ?? null,
          };
        }
        const screenCtx =
          baseContext +
          `\n# 対象画面: ${nav.label}` +
          (nav.screenType ? `（${nav.screenType}）` : "") +
          (nav.targetObject ? ` / 主対象オブジェクト: ${nav.targetObject}` : "");
        const r = await generateScreenComponent({
          label: nav.label,
          componentName,
          context: screenCtx,
          provider: dsProvider,
          modelId: dsModelId,
        });
        done.push(r.label);
        // 進捗のライブ表示（並列のため競合し得るが、最終は completeJob で確定）
        void updateJobProgress(job.id, {
          screens: [...done],
          totalScreens: total,
        });
        return {
          label: r.label,
          componentName: r.componentName,
          source: r.source,
          failed: !r.ok,
          parent: nav.parent ?? null,
        };
      }),
    ),
    themePromise,
  ]);

  const html = buildDsHtml({
    projectName: p.projectName || "プロトタイプ",
    theme,
    brand: p.brand ? { palette: p.brand.palette } : null,
    // メニューは全項目(親子)で2階層描画。親はグループ見出し(画面なし)になる。
    nav: allNav.map((n) => ({
      label: n.label,
      parent: n.parent ?? null,
      icon: n.icon ?? null,
    })),
    screens: screensOut.map((s) => ({
      label: s.label,
      componentName: s.componentName,
      source: s.source,
      failed: s.failed,
    })),
  });
  const failedScreens = screensOut.filter((s) => s.failed).map((s) => s.label);
  // html・画面別ソース・テーマを一緒に保存（次回の部分再生成でマージ元に使う）。
  await savePrototype(job.ownerId, job.projectId, {
    html,
    dsScreens: screensOut,
    dsTheme: theme,
  });
  await completeJob(
    job.id,
    { html, engine: "ds", failedScreens },
    {
      chars: html.length,
      screens: screensOut.map((s) => s.label),
      totalScreens: total,
    },
  );
}

/** 保存ソースの関数名（旧 componentName）を新しい componentName に置換する。
 *  componentName は英数字のみ（Screen+index）なので識別子境界で安全に置換できる。 */
function renameComponent(source: string, from: string, to: string): string {
  if (from === to) return source;
  return source.replace(new RegExp(`\\b${from}\\b`, "g"), to);
}

interface BriefPayload {
  provider?: LlmProvider;
  modelId?: string;
}

/** 提案資料(deck)の生成と保存。 */
async function runDeckJob(job: JobRow): Promise<void> {
  const p = job.payload as BriefPayload;
  const artifacts = await getProjectWithArtifacts(job.ownerId, job.projectId);
  if (!artifacts) throw new Error("Project not found");
  const deck = await generateDeck(
    buildDeckContext(artifacts),
    p.provider,
    p.modelId,
  );
  await saveDeck(job.ownerId, job.projectId, deck);
  await completeJob(job.id, { deck });
}

/** デザイナー依頼ブリーフの下書き生成（保存はユーザー操作時に別途行う）。 */
async function runDesignBriefJob(job: JobRow): Promise<void> {
  const p = job.payload as BriefPayload;
  const artifacts = await getProjectWithArtifacts(job.ownerId, job.projectId);
  if (!artifacts) throw new Error("Project not found");
  const brief = await generateDesignBrief({
    context: buildDesignBriefContext(artifacts),
    provider: p.provider,
    modelId: p.modelId,
  });
  await completeJob(job.id, { brief });
}

/** エンジニア依頼ブリーフの下書き生成（保存はユーザー操作時に別途行う）。 */
async function runEngineerBriefJob(job: JobRow): Promise<void> {
  const p = job.payload as BriefPayload;
  const artifacts = await getProjectWithArtifacts(job.ownerId, job.projectId);
  if (!artifacts) throw new Error("Project not found");
  const brief = await generateEngineerBrief({
    context: buildEngineerBriefContext(artifacts),
    provider: p.provider,
    modelId: p.modelId,
  });
  await completeJob(job.id, { brief });
}

interface RefinePayload {
  engine?: "v0" | "aws";
  provider?: LlmProvider;
  modelId?: string;
  figmaUrl?: string;
  pdfName?: string;
  pdfData?: string;
  note?: string;
}

/** デザイナー成果物（Figma/PDF）を参照してプロトタイプをブラッシュアップする。
 *  プロトタイプと依頼状態（received）を保存する。 */
async function runDesignRefineJob(job: JobRow): Promise<void> {
  const p = job.payload as RefinePayload;
  const hasFigma = !!p.figmaUrl?.trim();
  const hasPdf = !!p.pdfName?.trim();
  if (!hasFigma && !hasPdf) {
    throw new Error("Figma URL もしくは PDF を指定してください");
  }

  const artifacts = await getProjectWithArtifacts(job.ownerId, job.projectId);
  if (!artifacts) throw new Error("Project not found");

  const refineReference: PrototypeContext["refineReference"] = hasFigma
    ? { type: "figma", url: p.figmaUrl?.trim(), note: p.note }
    : { type: "pdf", url: p.pdfName?.trim(), note: p.note };
  const ctx = buildRefinePrototypeContext(artifacts, refineReference);

  let result: { html?: string; demoUrl?: string | null };
  if (p.engine === "v0") {
    const r = await createPrototype(ctx);
    await savePrototype(job.ownerId, job.projectId, {
      v0ChatId: r.chatId,
      demoUrl: r.demoUrl,
    });
    result = { demoUrl: r.demoUrl };
  } else {
    const html = await generatePrototypeHtml(ctx, p.provider, p.modelId);
    await savePrototype(job.ownerId, job.projectId, { html });
    result = { html };
  }

  // 依頼状態を「成果物受領（received）」に更新し、成果物参照を保存
  await saveDesignRequest(job.ownerId, job.projectId, {
    status: "received",
    figmaUrl: hasFigma ? (p.figmaUrl?.trim() ?? null) : null,
    pdfName: hasPdf ? (p.pdfName?.trim() ?? null) : null,
    pdfData: hasPdf ? (p.pdfData ?? null) : null,
    refinedNote: p.note ?? null,
  });

  await completeJob(job.id, result);
}
