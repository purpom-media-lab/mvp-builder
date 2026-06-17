/**
 * LLM モデル解決（サーバ専用：AI SDK provider パッケージを import）
 *
 * UI/API から provider + 任意の modelId を受け取り、AI SDK の LanguageModel を解決する。
 * クライアントから使うカタログ（純データ）は ./catalog.ts。
 */
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { DEFAULT_PROVIDER, type LlmProvider, MODEL_CATALOG } from "./catalog";

export {
  DEFAULT_PROVIDER,
  type LlmProvider,
  MODEL_CATALOG,
  PROVIDERS,
} from "./catalog";

/** provider + modelId から AI SDK の LanguageModel を解決 */
export function resolveModel(
  provider: LlmProvider = DEFAULT_PROVIDER,
  modelId?: string,
): LanguageModel {
  const cfg = MODEL_CATALOG[provider];
  const id = modelId ?? cfg.defaultModel;
  switch (provider) {
    case "claude":
      return anthropic(id);
    case "openai":
      return openai(id);
    case "gemini":
      return google(id);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
