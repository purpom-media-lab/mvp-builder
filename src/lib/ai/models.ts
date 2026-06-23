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
 * プロトタイプ生成の出力トークン上限。
 *
 * 2つの制約で決める:
 * 1) 未指定だと @ai-sdk/anthropic は haiku-4-5 や未知モデルで 4096 にフォールバックし、
 *    長い HTML が無言で切り詰められてしまう（明示して回避）。
 * 2) 生成本体は after() でサーバ関数（maxDuration=800s, Fluid Compute）内に走る。
 *    観測 ~65 tok/s で 800 秒なら ~50k tokens 程度が限界。余裕を見て下表に収める。
 *
 * 値はプロバイダの実上限も超えないようにする（超えると anthropic は known model を
 * クランプ、openai 等は API エラーになる）。これを超える大規模プロトタイプは
 * finishReason="length" で検知し（途中切れ警告）、「生成する画面」を絞った分割に誘導する。
 */
export function maxOutputTokensFor(
  provider: LlmProvider = DEFAULT_PROVIDER,
  modelId?: string,
): number {
  const id = (modelId ?? "").toLowerCase();
  switch (provider) {
    case "claude":
      if (id.includes("opus")) return 32000; // opus-4 の出力上限
      if (id.includes("haiku")) return 32000;
      return 48000; // sonnet 系（64k 上限だが 800 秒に収まる量に抑える）
    case "openai":
      return 16000; // gpt-4o 系の出力上限
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
