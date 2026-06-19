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
  generateNavigation,
  generateOoui,
  generateScope,
  generateUseCases,
  generateWireframes,
} from "@/lib/ai/steps";
import { getSessionUser } from "@/lib/auth/session";
import { saveStepResult, type StepKey } from "@/lib/projects";

export const runtime = "nodejs";
// 各工程のAI生成は30〜110秒かかることがあるため、Vercel関数の上限を引き上げる
// （60秒だと長い生成がタイムアウトして「終わらない」状態になる）
export const maxDuration = 300;

const STEP_FNS = {
  actors: generateActors,
  usecases: generateUseCases,
  ooui: generateOoui,
  journey: generateJourney,
  navigation: generateNavigation,
  wireframe: generateWireframes,
  datamodel: generateDataModel,
  backend: generateBackendSpec,
  scope: generateScope,
  kpi: generateKpi,
  growth: generateGrowth,
  brand: generateBrand,
} as const;

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

  try {
    const result = await fn({ context, provider, modelId });
    // プロジェクトに紐付いていれば保存（所有権は saveStepResult 内で検証）
    let saved = false;
    if (projectId) {
      saved = await saveStepResult(user.id, projectId, step, result);
    }
    return NextResponse.json({ result, saved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
