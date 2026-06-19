import { NextResponse } from "next/server";
import {
  DEFAULT_PROVIDER,
  FAST_MODEL,
  type LlmProvider,
} from "@/lib/ai/catalog";
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
import { streamJsonWithHeartbeat } from "@/lib/stream-keepalive";

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

/**
 * 高速モデルで実行する「軽い」工程（抽出系・構造が単純で品質影響が小さい）。
 * 重要な判断を伴う工程（ooui/scope/kpi/growth/brand/wireframe/datamodel/backend）は
 * 選択中のモデルのまま使う。
 */
const FAST_STEPS = new Set<StepKey>([
  "actors",
  "usecases",
  "journey",
  "navigation",
]);

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

  // 軽い抽出系の工程は高速モデルで実行して体感を速くする。
  // スコープ/モデリング等の品質が重要な工程は選択中のモデルのまま。
  const effectiveModelId = FAST_STEPS.has(step)
    ? FAST_MODEL[provider ?? DEFAULT_PROVIDER]
    : modelId;

  // ハートビートで接続を維持しながら生成（アイドル切断＝タイムアウトを抑制）。
  // 完了時に { result, saved } を、失敗時に { error } を最終JSONとして流す。
  return streamJsonWithHeartbeat(async () => {
    const result = await fn({ context, provider, modelId: effectiveModelId });
    // プロジェクトに紐付いていれば保存（所有権は saveStepResult 内で検証）
    let saved = false;
    if (projectId) {
      saved = await saveStepResult(user.id, projectId, step, result);
    }
    return { result, saved };
  });
}
