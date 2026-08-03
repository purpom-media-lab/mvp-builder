/**
 * ブランド分析から daisyUI 5 の「完全テーマ」を AI で提案する。
 *
 * daisyUI theme generator と同じ構造（全セマンティック変数）を、調和とコントラストを
 * 担保して生成する。失敗時は null（呼び出し側でブランドパレットにフォールバック）。
 *
 * system プロンプトと出力スキーマは theme-spec.ts にある
 * （Claude Code 版パイプラインと共有するため）。
 */
import { generateStructured } from "@/lib/ai/generate";
import type { LlmProvider } from "@/lib/ai/models";
import type { DaisyTheme } from "./shell";
import { THEME_SYSTEM, themeSchema } from "./theme-spec";

export interface GenerateThemeArgs {
  /** ブランド文脈（ブランド名・トーン・基調色・キーワード等をまとめた文字列） */
  context: string;
  provider?: LlmProvider;
  modelId?: string;
}

/** ブランド文脈から完全 daisyUI テーマを生成（失敗時 null）。 */
export async function generateDaisyTheme(
  args: GenerateThemeArgs,
): Promise<DaisyTheme | null> {
  try {
    const t = await generateStructured({
      schema: themeSchema,
      system: THEME_SYSTEM,
      prompt: `${args.context}\n\n上記ブランドに合う daisyUI 5 ライトテーマを設計してください。`,
      provider: args.provider,
      modelId: args.modelId,
      temperature: 0.4,
    });
    return t as DaisyTheme;
  } catch {
    return null;
  }
}
