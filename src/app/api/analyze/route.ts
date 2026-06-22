import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/catalog";
import { runAnalyzeStep, STEP_FNS } from "@/lib/ai/run-step";
import { getSessionUser } from "@/lib/auth/session";
import { saveStepResult, type StepKey } from "@/lib/projects";
import { streamJsonWithHeartbeat } from "@/lib/stream-keepalive";

export const runtime = "nodejs";
// 各工程のAI生成は30〜110秒かかることがあるため、Vercel関数の上限を引き上げる
// （60秒だと長い生成がタイムアウトして「終わらない」状態になる）
export const maxDuration = 300;

interface Body {
  step: StepKey;
  context: string;
  provider?: LlmProvider;
  modelId?: string;
  projectId?: string;
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

  const { step, context, provider, modelId, projectId } = body;
  const fn = STEP_FNS[step];
  if (!fn) {
    return NextResponse.json(
      { error: `Unknown step: ${step}` },
      { status: 400 },
    );
  }
  if (!context?.trim()) {
    return NextResponse.json({ error: "context is required" }, { status: 400 });
  }

  // ハートビートで接続を維持しながら生成（アイドル切断＝タイムアウトを抑制）。
  // 完了時に { result, saved } を、失敗時に { error } を最終JSONとして流す。
  return streamJsonWithHeartbeat(async () => {
    const result = await runAnalyzeStep({ step, context, provider, modelId });
    // プロジェクトに紐付いていれば保存（所有権は saveStepResult 内で検証）
    let saved = false;
    if (projectId) {
      saved = await saveStepResult(user.id, projectId, step, result);
    }
    return { result, saved };
  });
}
