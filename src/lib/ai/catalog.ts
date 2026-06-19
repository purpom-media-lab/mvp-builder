/**
 * LLM プロバイダ/モデルのカタログ（純データ・クライアント安全）
 *
 * AI SDK の provider パッケージを import しないため、クライアントコンポーネント
 * （モデルセレクタ等）からも安全に参照できる。実際のモデル解決は ./models.ts。
 */
export type LlmProvider = "claude" | "openai" | "gemini";

export const MODEL_CATALOG: Record<
  LlmProvider,
  { label: string; models: string[]; defaultModel: string }
> = {
  claude: {
    label: "Claude (Anthropic)",
    models: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-4-6",
  },
  openai: {
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
    defaultModel: "gpt-4o",
  },
  gemini: {
    label: "Gemini (Google)",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    defaultModel: "gemini-2.5-flash",
  },
};

export const PROVIDERS = Object.keys(MODEL_CATALOG) as LlmProvider[];

export const DEFAULT_PROVIDER: LlmProvider = "claude";

/**
 * 各プロバイダの「高速・低コスト」モデル。
 * 軽い工程（抽出系など品質影響の小さい工程）に使って体感を速くする。
 * 重要な工程は選択中のモデルのまま使う。
 */
export const FAST_MODEL: Record<LlmProvider, string> = {
  claude: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

/**
 * 各プロバイダの「賢さ優先」モデル。
 * 品質を最優先したい工程に使う（「賢さ優先プリセット」など）。
 */
export const SMART_MODEL: Record<LlmProvider, string> = {
  claude: "claude-opus-4-8",
  openai: "gpt-4o",
  gemini: "gemini-2.5-pro",
};
