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
 * 2つの理由で明示する:
 * 1) 未指定だと @ai-sdk/anthropic は haiku-4-5 や未知モデルで 4096 にフォールバックし、
 *    長い HTML が無言で切り詰められてしまう。
 * 2) 生成本体は after() でサーバ関数（maxDuration=300s）内に走るため、出力が大きすぎると
 *    300 秒で打ち切られて「タイムアウト」になる。観測では ~65 tok/s で、300 秒なら
 *    せいぜい ~18k tokens しか出せない。そこで 16k を上限にして時間内に完結させる。
 *
 * これを超える大規模プロトタイプは finishReason="length" で検知し（途中切れ警告）、
 * 「生成する画面」を絞った分割生成に誘導する。Vercel の Fluid Compute を有効化して
 * maxDuration を伸ばせれば、この値も引き上げられる。
 */
export function maxOutputTokensFor(): number {
  return 16000;
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
