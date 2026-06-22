/**
 * ジョブ本体の実処理（サーバ専用）。
 *
 * app/api/jobs の POST が after() からこの runJob を呼ぶ。生成→ドメイン保存→
 * jobs 行の更新まで行い、クライアント接続とは独立して完走する。
 * 既存の生成ロジック（runAnalyzeStep / runPipelineParallel / streamPrototypeHtml 等）を
 * そのまま再利用する。
 */
import { extractHtmlFromText } from "@/lib/api-client";
import type { LlmProvider } from "@/lib/ai/catalog";
import { generateDeck } from "@/lib/ai/deck";
import { runPipelineParallel, STEP_ROLES } from "@/lib/ai/pipeline";
import {
  buildDeckContext,
  buildDesignBriefContext,
  buildEngineerBriefContext,
} from "@/lib/ai/project-context";
import { isStepKey, runAnalyzeStep } from "@/lib/ai/run-step";
import { generateDesignBrief, generateEngineerBrief } from "@/lib/ai/steps";
import {
  realizePrototypeHtml,
  streamPrototypeHtml,
  streamUpdatePrototypeHtml,
} from "@/lib/prototype-html";
import { parseScreenNames } from "@/lib/prototype-screens";
import {
  getProjectWithArtifacts,
  saveDeck,
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
import type { PrototypeContext } from "@/lib/v0";

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
    artifacts.sourceText && `## 入力資料\n${artifacts.sourceText}`,
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
  mode?: "create" | "update" | "realize";
  instruction?: string;
  currentHtml?: string;
}

async function runPrototypeJob(job: JobRow): Promise<void> {
  const p = job.payload as unknown as PrototypePayload;
  const mode = p.mode ?? "create";

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

  const html = extractHtmlFromText(acc);
  const screens = parseScreenNames(html);
  await savePrototype(job.ownerId, job.projectId, { html });
  await completeJob(job.id, { html }, { chars: html.length, screens });
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
