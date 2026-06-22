/**
 * 単一工程の生成を実行する共有ヘルパー。
 *
 * /api/analyze（同期）とジョブランナー（非同期 after()）の双方から使い、
 * 工程→ジェネレータの対応・高速モデルの既定切り替えロジックを一元化する。
 */
import { DEFAULT_PROVIDER, FAST_MODEL, type LlmProvider } from "./catalog";
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
} from "./steps";
import type { StepKey } from "@/lib/projects";

export const STEP_FNS = {
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
export const FAST_STEPS = new Set<StepKey>([
  "actors",
  "usecases",
  "journey",
  "navigation",
]);

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === "string" && v in STEP_FNS;
}

/**
 * 工程を生成する。明示モデルが来たらそれを最優先（工程ごとのモデル設定を尊重）。
 * 明示が無い場合のみ、軽い抽出系の工程は高速モデルで実行して体感を速くする。
 */
export function runAnalyzeStep(args: {
  step: StepKey;
  context: string;
  provider?: LlmProvider;
  modelId?: string;
}) {
  const { step, context, provider, modelId } = args;
  const fn = STEP_FNS[step];
  const effectiveModelId =
    modelId ??
    (FAST_STEPS.has(step) ? FAST_MODEL[provider ?? DEFAULT_PROVIDER] : modelId);
  return fn({ context, provider, modelId: effectiveModelId });
}
