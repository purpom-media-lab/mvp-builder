/**
 * 統合チャット・オーケストレーター。
 *
 * 自然言語の要望を受け取り、(1) どの分析工程を再実行すべきかを LLM で計画し、
 * (2) 依存順に該当工程を自動実行・保存し、(3) 結果と「プロトタイプ再生成すべきか」を返す。
 * ビジネス/顧客状態に応じて OOUI 分析を自動で回し、最適な UI を再提案するための中核。
 */
import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/catalog";
import {
  generateActors,
  generateBackendSpec,
  generateBrand,
  generateDataModel,
  generateGrowth,
  generateJourney,
  generateKpi,
  generateMarket,
  generateNavigation,
  generateOoui,
  generateScope,
  generateUseCases,
  generateWireframes,
  planOrchestration,
} from "@/lib/ai/steps";
import { getSessionUser } from "@/lib/auth/session";
import {
  getProjectWithArtifacts,
  saveStepResult,
  type StepKey,
} from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

const STEP_FNS = {
  actors: generateActors,
  usecases: generateUseCases,
  ooui: generateOoui,
  journey: generateJourney,
  market: generateMarket,
  navigation: generateNavigation,
  wireframe: generateWireframes,
  datamodel: generateDataModel,
  backend: generateBackendSpec,
  scope: generateScope,
  kpi: generateKpi,
  growth: generateGrowth,
  brand: generateBrand,
} as const;

const STEP_ORDER: StepKey[] = [
  "actors",
  "usecases",
  "journey",
  "market",
  "ooui",
  "navigation",
  "wireframe",
  "datamodel",
  "backend",
  "scope",
  "kpi",
  "growth",
  "brand",
];

type Artifacts = NonNullable<
  Awaited<ReturnType<typeof getProjectWithArtifacts>>
>;

/** 要求された工程を依存順に正規化する。ooui（モデリング）を再実行するときは、
 *  ナビゲーションを OOUI から自動導出し直すため navigation を必ず後続に含める。 */
function normalizeSteps(requested: StepKey[]): StepKey[] {
  const set = new Set(requested);
  if (set.has("ooui")) set.add("navigation");
  return STEP_ORDER.filter((s) => set.has(s));
}

function buildContext(a: Artifacts): string {
  return [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.detail && `## 入力資料\n${a.detail}`,
    a.analysisResult && `## ジョブ分析\n${a.analysisResult}`,
    a.sourceText && `## 参考資料\n${a.sourceText}`,
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    a.ooui.length && `## OOUIオブジェクト\n${JSON.stringify(a.ooui)}`,
    a.journey.length && `## ジャーニー\n${JSON.stringify(a.journey)}`,
    a.market && `## 市場・競合\n${JSON.stringify(a.market)}`,
    a.navigation.length && `## ナビゲーション\n${JSON.stringify(a.navigation)}`,
    a.wireframes.length &&
      `## ワイヤーフレーム\n${JSON.stringify(a.wireframes)}`,
    a.dataModel.length && `## データ設計\n${JSON.stringify(a.dataModel)}`,
    a.scope.length && `## スコープ\n${JSON.stringify(a.scope)}`,
    a.mvpStatement && `## MVPステートメント\n${a.mvpStatement}`,
    (a.kpi.northStar || a.kpi.supporting.length) &&
      `## KPI\n${JSON.stringify(a.kpi)}`,
    a.growthPlan && `## グロース計画\n${JSON.stringify(a.growthPlan)}`,
    a.brand && `## ブランド\n${JSON.stringify(a.brand)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface Body {
  projectId?: string;
  message?: string;
  provider?: LlmProvider;
  modelId?: string;
  /** "plan"=計画のみ返す / "execute"=承認済みの steps を実行（省略時は従来通り計画+即実行） */
  mode?: "plan" | "execute";
  /** mode=execute のとき実行する工程（plan の plannedSteps を承認したもの） */
  steps?: StepKey[];
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.projectId || !body.message?.trim()) {
    return NextResponse.json(
      { error: "projectId と message は必須です" },
      { status: 400 },
    );
  }

  const artifacts = await getProjectWithArtifacts(user.id, body.projectId);
  if (!artifacts) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    let context = buildContext(artifacts);

    // mode=execute: 承認済みの steps を実行（計画ステップを省略）
    if (body.mode === "execute") {
      const steps = normalizeSteps(body.steps ?? []);
      const requirement = `\n\n## ユーザーからの変更要望（必ず反映すること）\n${body.message}`;
      const results: Record<string, unknown> = {};
      for (const step of steps) {
        const result = await STEP_FNS[step]({
          context: context + requirement,
          provider: body.provider,
          modelId: body.modelId,
        });
        await saveStepResult(user.id, body.projectId, step, result);
        results[step] = result;
        context += `\n\n## ${step}（更新）\n${JSON.stringify(result)}`;
      }
      return NextResponse.json({ ranSteps: steps, results });
    }

    const plan = await planOrchestration({
      context,
      message: body.message,
      provider: body.provider,
      modelId: body.modelId,
    });

    // 依存順に正規化（ooui を含むなら navigation を自動追随）
    const steps = normalizeSteps(plan.steps);

    // mode=plan: 計画だけ返して実行しない（承認フロー用）
    if (body.mode === "plan") {
      return NextResponse.json({
        reply: plan.reply,
        plannedSteps: steps,
        regeneratePrototype: plan.regeneratePrototype,
      });
    }

    // 既定: 計画＋即実行（従来動作）
    const requirement = `\n\n## ユーザーからの変更要望（必ず反映すること）\n${body.message}`;
    const results: Record<string, unknown> = {};
    for (const step of steps) {
      const result = await STEP_FNS[step]({
        context: context + requirement,
        provider: body.provider,
        modelId: body.modelId,
      });
      await saveStepResult(user.id, body.projectId, step, result);
      results[step] = result;
      // 後続工程が最新結果を参照できるようコンテキストへ追記
      context += `\n\n## ${step}（更新）\n${JSON.stringify(result)}`;
    }

    return NextResponse.json({
      reply: plan.reply,
      ranSteps: steps,
      results,
      regeneratePrototype: plan.regeneratePrototype,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "オーケストレーション失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
