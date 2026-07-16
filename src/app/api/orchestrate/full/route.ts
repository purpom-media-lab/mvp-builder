/**
 * AIチームによる「一括生成（並列）」。
 * 全工程をロール分担＋依存ウェーブで並列実行し、各結果を保存して返す。
 * ハートビートで接続を維持し、長時間でもタイムアウトしない。
 */
import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/catalog";
import { jtbdSection } from "@/lib/ai/context-sections";
import { runPipelineParallel, STEP_ROLES } from "@/lib/ai/pipeline";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts, saveStepResult } from "@/lib/projects";
import { streamJsonWithHeartbeat } from "@/lib/stream-keepalive";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  projectId?: string;
  provider?: LlmProvider;
  modelId?: string;
  /** 工程ごとのモデル指定（任意）。各工程でこれを最優先で使う。 */
  modelByStep?: Record<string, { provider?: LlmProvider; modelId?: string }>;
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
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId は必須です" }, { status: 400 });
  }

  const artifacts = await getProjectWithArtifacts(user.id, body.projectId);
  if (!artifacts) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const projectId = body.projectId;
  const baseContext = [
    `# プロジェクト: ${artifacts.project.name}`,
    artifacts.project.summary && `## 概要\n${artifacts.project.summary}`,
    artifacts.detail && `## 入力資料\n${artifacts.detail}`,
    artifacts.analysisResult && jtbdSection(artifacts.analysisResult),
    artifacts.sourceText && `## 参考資料\n${artifacts.sourceText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return streamJsonWithHeartbeat(async () => {
    const results = await runPipelineParallel({
      baseContext,
      provider: body.provider,
      modelId: body.modelId,
      modelByStep: body.modelByStep,
      onStepDone: async (step, result) => {
        await saveStepResult(
          user.id,
          projectId,
          step,
          result as Parameters<typeof saveStepResult>[3],
        );
      },
    });
    return { results, roles: STEP_ROLES };
  });
}
