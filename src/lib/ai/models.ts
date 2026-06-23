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

/**
 * モデル別の安全な出力トークン上限。
 *
 * 未指定だと @ai-sdk/anthropic はモデル別の既定（sonnet-4=64k / opus-4=32k だが、
 * haiku-4-5 や未知モデルは 4096）にフォールバックし、長い HTML が無言で切り詰められる。
 * プロトタイプ生成のように出力が大きい用途では明示して切り詰めを防ぐ。
 * 各プロバイダの実上限を超えない範囲で、十分大きい値を返す。
 */
export function maxOutputTokensFor(
  provider: LlmProvider = DEFAULT_PROVIDER,
  modelId?: string,
): number {
  const id = (modelId ?? "").toLowerCase();
  switch (provider) {
    case "claude":
      if (id.includes("opus")) return 32000;
      if (id.includes("haiku")) return 32000;
      return 64000; // sonnet 系など
    case "openai":
      return 16000; // gpt-4o 系の出力上限に合わせる
    case "gemini":
      return 32000;
    default:
      return 16000;
  }
}

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
