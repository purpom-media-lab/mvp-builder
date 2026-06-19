/**
 * 工程（機能）ごとのモデル設定（per-step model preferences）。
 *
 * 1つのモデルを全工程に使う代わりに、工程ごとに最適なモデル（速い/賢い）を
 * 割り当てられるようにする。保存は localStorage（projectId 単位）で、DB は変更しない。
 *
 * 後方互換: 設定が無ければ getModelForStep は「軽い工程=FAST_MODEL / それ以外=fallback」
 * という従来どおりの既定にフォールバックするため、完全に現状動作のままになる。
 */
import { FAST_MODEL, type LlmProvider, SMART_MODEL } from "./ai/catalog";
import type { StepKey } from "./studio-types";

export interface ModelPref {
  provider: LlmProvider;
  modelId: string;
}

/** 12 工程に加えて、画面（機能）単位の設定キー。 */
export type FeatureKey =
  | "prototype"
  | "deck"
  | "design-request"
  | "engineer-request";

export type PrefKey = StepKey | FeatureKey;

export type ModelPrefs = Partial<Record<PrefKey, ModelPref>>;

/**
 * 既定で高速モデルを割り当てる「軽い」工程
 * （analyze ルート / pipeline と同方針）。
 */
export const FAST_PREF_STEPS = new Set<StepKey>([
  "actors",
  "usecases",
  "journey",
  "navigation",
]);

/** 設定 UI のグループ（カテゴリ見出し付き）。 */
export const PREF_GROUPS: { label: string; keys: { key: PrefKey; label: string }[] }[] =
  [
    {
      label: "分析",
      keys: [
        { key: "actors", label: "アクター" },
        { key: "usecases", label: "ユースケース" },
        { key: "ooui", label: "モデリング" },
        { key: "journey", label: "ジャーニー" },
      ],
    },
    {
      label: "設計",
      keys: [
        { key: "navigation", label: "ナビゲーション" },
        { key: "wireframe", label: "ワイヤー" },
        { key: "datamodel", label: "データ設計" },
        { key: "backend", label: "バックエンド" },
      ],
    },
    {
      label: "MVP定義",
      keys: [
        { key: "scope", label: "スコープ" },
        { key: "kpi", label: "KPI" },
        { key: "growth", label: "グロース計画" },
        { key: "brand", label: "デザイン" },
      ],
    },
    {
      label: "成果物・依頼",
      keys: [
        { key: "prototype", label: "プロトタイプ" },
        { key: "deck", label: "提案資料（deck）" },
        { key: "design-request", label: "デザイナー依頼" },
        { key: "engineer-request", label: "エンジニア依頼" },
      ],
    },
  ];

/** 全設定キー（プリセット適用などに使う）。 */
export const ALL_PREF_KEYS: PrefKey[] = PREF_GROUPS.flatMap((g) =>
  g.keys.map((k) => k.key),
);

function storageKey(projectId: string): string {
  return `lq_model_prefs_${projectId}`;
}

/** localStorage から設定を読み込む（無ければ空）。 */
export function loadModelPrefs(projectId: string): ModelPrefs {
  if (typeof window === "undefined" || !projectId) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ModelPrefs;
  } catch {
    // 壊れた値は無視して空扱い
  }
  return {};
}

/** localStorage に設定を保存する。 */
export function saveModelPrefs(projectId: string, prefs: ModelPrefs): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(prefs));
  } catch {
    // 保存失敗は致命的でないため握りつぶす
  }
}

/**
 * 設定が無いキーの既定モデル。
 * 軽い工程は fallback の provider の FAST_MODEL、それ以外は fallback そのまま。
 */
export function defaultModelForKey(key: PrefKey, fallback: ModelPref): ModelPref {
  if (FAST_PREF_STEPS.has(key as StepKey)) {
    return { provider: fallback.provider, modelId: FAST_MODEL[fallback.provider] };
  }
  return fallback;
}

/**
 * その工程（機能）に使うモデルを決める。
 * - 明示設定があればそれを使う
 * - 無ければ defaultModelForKey（軽い工程=FAST / それ以外=fallback）
 */
export function getModelForStep(
  prefs: ModelPrefs,
  key: PrefKey,
  fallback: ModelPref,
): ModelPref {
  return prefs[key] ?? defaultModelForKey(key, fallback);
}

/** プリセット（一括設定）の種類。 */
export type PresetKind = "fast" | "smart";

/**
 * 全キーを一括設定したプリセットを作る。
 * - fast: 全工程を fallback の provider の FAST_MODEL に
 * - smart: 全工程を fallback の provider の SMART_MODEL に
 */
export function buildPreset(kind: PresetKind, base: ModelPref): ModelPrefs {
  const modelId =
    kind === "fast" ? FAST_MODEL[base.provider] : SMART_MODEL[base.provider];
  const prefs: ModelPrefs = {};
  for (const key of ALL_PREF_KEYS) {
    prefs[key] = { provider: base.provider, modelId };
  }
  return prefs;
}
