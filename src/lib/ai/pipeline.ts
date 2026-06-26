/**
 * AIチームによる並列パイプライン。
 *
 * 単一AIで全工程を順番に回すのではなく、工程ごとに「専門ロール」を割り当て、
 * 依存関係を満たす範囲で**並列実行**して高速化する。
 * 例: ユースケース確定後、OOUI / ジャーニー / スコープ / ブランドを同時に走らせる。
 */
import { FAST_MODEL, type LlmProvider } from "./catalog";
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
import type { StepKey } from "../projects";

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

/** 各工程の担当ロール（専門家ペルソナ）。プロンプトにも注入し、UI 表示にも使う。 */
export const STEP_ROLES: Record<StepKey, string> = {
  actors: "ビジネスアナリスト",
  usecases: "ビジネスアナリスト",
  ooui: "UXアーキテクト",
  journey: "UXデザイナー",
  navigation: "情報設計（IA）デザイナー",
  wireframe: "UIデザイナー",
  datamodel: "データアーキテクト",
  backend: "バックエンドエンジニア",
  scope: "プロダクトマネージャー",
  kpi: "グロース／データアナリスト",
  growth: "グロース担当",
  brand: "ブランドデザイナー",
};

/** 軽い工程は高速モデルで（analyze ルートと同方針）。
 *  navigation は OOUI オブジェクト/関連の構造推論が要るため除外し、選択モデルで生成する。 */
const FAST_STEPS = new Set<StepKey>([
  "actors",
  "usecases",
  "journey",
]);

/**
 * 依存を満たす実行ウェーブ。同一ウェーブ内は並列。
 * 後段ほど前段の成果物をコンテキストとして参照する。
 */
const WAVES: StepKey[][] = [
  ["actors"],
  ["usecases"],
  ["ooui", "journey", "scope", "brand"],
  ["navigation", "datamodel", "kpi"],
  ["wireframe", "backend", "growth"],
];

export interface PipelineOptions {
  baseContext: string;
  provider?: LlmProvider;
  modelId?: string;
  /**
   * 工程ごとのモデル指定（任意）。指定があれば各工程でこれを最優先で使う。
   * 無い工程は従来どおり provider/modelId（軽い工程は FAST_MODEL）にフォールバック。
   */
  modelByStep?: Partial<Record<StepKey, { provider?: LlmProvider; modelId?: string }>>;
  /** 各工程の完了ごとに呼ばれる（保存などに使う）。 */
  onStepDone?: (step: StepKey, result: unknown) => Promise<void> | void;
}

/**
 * 全工程をロール分担＋並列ウェーブで実行する。
 * 返り値は { actors: <result>, usecases: <result>, ... } の Record（applyOrchestrate 互換）。
 */
export async function runPipelineParallel(
  opts: PipelineOptions,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  let context = opts.baseContext;

  for (const wave of WAVES) {
    const ctxSnapshot = context; // ウェーブ内は同じ前提コンテキストを共有
    const waveResults = await Promise.all(
      wave.map(async (step) => {
        const role = STEP_ROLES[step];
        const roledContext = `あなたは新規事業開発チームの「${role}」です。担当領域の専門家として、最高品質で作成してください。\n\n${ctxSnapshot}`;
        // 工程ごとの明示モデルを最優先。無ければ従来どおり
        // （軽い工程は FAST_MODEL、それ以外は選択中の modelId）。
        const pref = opts.modelByStep?.[step];
        const provider = pref?.provider ?? opts.provider;
        const modelId =
          pref?.modelId ??
          (FAST_STEPS.has(step) ? FAST_MODEL[provider ?? "claude"] : opts.modelId);
        const result = await STEP_FNS[step]({
          context: roledContext,
          provider,
          modelId,
        });
        await opts.onStepDone?.(step, result);
        return [step, result] as const;
      }),
    );
    for (const [step, result] of waveResults) {
      results[step] = result;
      context += `\n\n## ${step}（${STEP_ROLES[step]}）\n${JSON.stringify(result)}`;
    }
  }

  return results;
}
