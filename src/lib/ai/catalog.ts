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
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash",
  },
};

export const PROVIDERS = Object.keys(MODEL_CATALOG) as LlmProvider[];

export const DEFAULT_PROVIDER: LlmProvider = "claude";
