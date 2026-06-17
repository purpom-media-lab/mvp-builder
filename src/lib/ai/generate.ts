/**
 * 構造化生成ヘルパー（AI SDK generateObject）
 *
 * OOUI パイプラインの各工程は、選択された LLM（Claude/OpenAI/Gemini）で
 * Zod スキーマに沿った構造化出力を得る。
 */
import { generateObject } from "ai";
import type { z } from "zod";
import { type LlmProvider, resolveModel } from "./models";

export interface GenerateStructuredArgs<T> {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  provider?: LlmProvider;
  modelId?: string;
  temperature?: number;
}

export async function generateStructured<T>({
  schema,
  system,
  prompt,
  provider,
  modelId,
  temperature = 0.7,
}: GenerateStructuredArgs<T>): Promise<T> {
  const { object } = await generateObject({
    model: resolveModel(provider, modelId),
    schema,
    system,
    prompt,
    temperature,
  });
  return object as T;
}
