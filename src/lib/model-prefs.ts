/**
 * 工程（機能）ごとのモデル設定（per-step model preferences）。
 *
 * 1つのモデルを全工程に使う代わりに、工程ごとに最適なモデル（速い/賢い）を
 * 割り当てられるようにする。保存は localStorage（projectId 単位）で、DB は変更しない。
 *
 * 後方互換: 設定が無ければ getModelForStep は「軽い工程=FAST_MODEL / それ以外=fallback」
 * という従来どおりの既定にフォールバックするため、完全に現状動作のままになる。
 */
import {
  DEFAULT_PROVIDER,
  FAST_MODEL,
  type LlmProvider,
  MODEL_CATALOG,
  SMART_MODEL,
} from "./ai/catalog";
import type { StepKey } from "./studio-types";

export interface ModelPref {
  provider: LlmProvider;
  modelId: string;
}

/** 工程別設定の基準（プリセット・未設定工程の既定）に使うモデル。 */
export const DEFAULT_BASE_MODEL: ModelPref = {
  provider: DEFAULT_PROVIDER,
  modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
};

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
        { key: "brand", label: "デザイン" },
      ],
    },
    {
      label: "MVP定義",
      keys: [
        { key: "scope", label: "スコープ" },
        { key: "kpi", label: "KPI" },
        { key: "growth", label: "グロース計画" },
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

function baseStorageKey(projectId: string): string {
  return `lq_model_base_${projectId}`;
}

/**
 * 基準モデルを localStorage から読み込む（無ければ既定）。
 * プリセット適用と未設定工程の既定（getModelForStep の fallback）に使う。
 */
export function loadBaseModel(projectId: string): ModelPref {
  if (typeof window === "undefined" || !projectId) return DEFAULT_BASE_MODEL;
  try {
    const raw = window.localStorage.getItem(baseStorageKey(projectId));
    if (!raw) return DEFAULT_BASE_MODEL;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.provider && parsed.modelId) {
      return parsed as ModelPref;
    }
  } catch {
    // 壊れた値は無視して既定扱い
  }
  return DEFAULT_BASE_MODEL;
}

/** 基準モデルを localStorage に保存する。 */
export function saveBaseModel(projectId: string, base: ModelPref): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.localStorage.setItem(baseStorageKey(projectId), JSON.stringify(base));
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

/* ------------------------------------------------------------------ *
 * 利用ログ（usage log）
 *
 * 各工程（機能）の生成呼び出しの所要時間・成否を localStorage に蓄積し、
 * 「履歴からAIで最適化」機能の入力に使う。DB は変更しない。
 * ------------------------------------------------------------------ */

/** 利用ログ 1 件分。step は PrefKey に加え "full"（一括生成）等も入りうる。 */
export interface UsageRecord {
  step: string;
  provider: LlmProvider;
  modelId: string;
  /** 所要時間（ミリ秒） */
  ms: number;
  /** 成功したか */
  ok: boolean;
  /** 記録時刻（epoch ms） */
  t: number;
}

/** 工程×モデルごとの集計値。 */
export interface UsageStat {
  provider: LlmProvider;
  modelId: string;
  count: number;
  avgMs: number;
  /** 成功率（0〜1） */
  okRate: number;
}

/** 工程キー → そのキーで使われたモデルごとの集計（呼び出し回数の多い順）。 */
export type UsageStats = Record<string, UsageStat[]>;

/** 直近で保持するログ件数（循環バッファ）。 */
const USAGE_LIMIT = 200;

function usageStorageKey(projectId: string): string {
  return `lq_model_usage_${projectId}`;
}

/** 生ログを読み込む（無ければ空配列）。 */
function loadUsage(projectId: string): UsageRecord[] {
  if (typeof window === "undefined" || !projectId) return [];
  try {
    const raw = window.localStorage.getItem(usageStorageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as UsageRecord[];
  } catch {
    // 壊れた値は無視
  }
  return [];
}

/**
 * 利用ログを 1 件追記する（直近 USAGE_LIMIT 件で循環）。
 * 計測のための関数なので、保存失敗は握りつぶし UI に影響させない。
 */
export function recordUsage(
  projectId: string,
  entry: { step: string; provider: LlmProvider; modelId: string; ms: number; ok: boolean },
): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    const list = loadUsage(projectId);
    list.push({
      step: entry.step,
      provider: entry.provider,
      modelId: entry.modelId,
      ms: Math.max(0, Math.round(entry.ms)),
      ok: entry.ok,
      t: Date.now(),
    });
    // 直近 USAGE_LIMIT 件だけ残す
    const trimmed = list.slice(-USAGE_LIMIT);
    window.localStorage.setItem(
      usageStorageKey(projectId),
      JSON.stringify(trimmed),
    );
  } catch {
    // 計測失敗は致命的でないため握りつぶす
  }
}

/**
 * 工程×モデルごとに { count, avgMs, okRate } を集計して返す。
 * 各工程の配列は呼び出し回数の多い順にソートされる。
 */
export function getUsageStats(projectId: string): UsageStats {
  const list = loadUsage(projectId);
  // step -> "provider:modelId" -> 集計用アキュムレータ
  const acc: Record<
    string,
    Record<string, { provider: LlmProvider; modelId: string; count: number; sumMs: number; okCount: number }>
  > = {};
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const stepKey = String(r.step);
    const modelKey = `${r.provider}:${r.modelId}`;
    const byModel = (acc[stepKey] ??= {});
    const cell = (byModel[modelKey] ??= {
      provider: r.provider,
      modelId: r.modelId,
      count: 0,
      sumMs: 0,
      okCount: 0,
    });
    cell.count += 1;
    cell.sumMs += typeof r.ms === "number" ? r.ms : 0;
    if (r.ok) cell.okCount += 1;
  }
  const out: UsageStats = {};
  for (const [stepKey, byModel] of Object.entries(acc)) {
    out[stepKey] = Object.values(byModel)
      .map((c) => ({
        provider: c.provider,
        modelId: c.modelId,
        count: c.count,
        avgMs: c.count ? Math.round(c.sumMs / c.count) : 0,
        okRate: c.count ? c.okCount / c.count : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }
  return out;
}

/**
 * ある工程の利用統計を 1 行サマリに丸める（全モデル合算）。
 * 履歴が無ければ null。ダイアログの「平均◯ms・◯回」表示に使う。
 */
export function summarizeStepUsage(
  stats: UsageStats,
  key: string,
): { count: number; avgMs: number; okRate: number } | null {
  const rows = stats[key];
  if (!rows || !rows.length) return null;
  const count = rows.reduce((s, r) => s + r.count, 0);
  if (!count) return null;
  const avgMs = Math.round(
    rows.reduce((s, r) => s + r.avgMs * r.count, 0) / count,
  );
  const okRate = rows.reduce((s, r) => s + r.okRate * r.count, 0) / count;
  return { count, avgMs, okRate };
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
