/**
 * ブランド分析から daisyUI 5 の「完全テーマ」を AI で提案する。
 *
 * daisyUI theme generator と同じ構造（全セマンティック変数）を、調和とコントラストを
 * 担保して生成する。失敗時は null（呼び出し側でブランドパレットにフォールバック）。
 */
import { z } from "zod";
import { generateStructured } from "@/lib/ai/generate";
import type { LlmProvider } from "@/lib/ai/models";
import type { DaisyTheme } from "./shell";

const hex = z
  .string()
  .describe("HEXカラー #rrggbb 形式")
  .regex(/^#[0-9a-fA-F]{6}$/);

const themeSchema = z.object({
  primary: hex,
  primaryContent: hex.describe("primary 上の文字色。コントラスト確保"),
  secondary: hex,
  secondaryContent: hex,
  accent: hex,
  accentContent: hex,
  neutral: hex,
  neutralContent: hex,
  base100: hex.describe("ページ背景の基調色（明るい面）"),
  base200: hex.describe("base100 よりわずかに濃い"),
  base300: hex.describe("base200 よりわずかに濃い"),
  baseContent: hex.describe("base 面上の本文色。十分なコントラスト"),
  info: hex,
  infoContent: hex,
  success: hex,
  successContent: hex,
  warning: hex,
  warningContent: hex,
  error: hex,
  errorContent: hex,
  radius: z
    .enum(["0rem", "0.25rem", "0.5rem", "1rem"])
    .describe("角丸の基調"),
  depth: z.union([z.literal(0), z.literal(1)]).describe("立体感 0/1"),
});

const SYSTEM = `あなたは UI のカラーシステム設計の専門家です。ブランド情報から daisyUI 5 の完全なライトテーマを設計します。

ルール（daisyUI 公式準拠）:
- ブランドの基調色を primary に置く。secondary / accent は primary と調和する補色・近似色にする。
- *-content（primary-content など）は、その背景色の上で読みやすいよう **十分なコントラスト**（明るい背景→濃い文字、濃い背景→明るい文字）にする。
- base-100/200/300 はページの大半に使う面色。base-100 を最も明るく、200→300 と少しずつ濃く。ライトテーマなので base-100 はほぼ白〜淡色。base-content は base-100 上で読める濃い色。
- info=青系 / success=緑系 / warning=黄〜橙系 / error=赤系 を、ブランドトーンに馴染む彩度で。
- 全体に統一感・アクセシブルな配色。奇抜にしすぎない。
- 値はすべて #rrggbb の HEX。`;

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
      system: SYSTEM,
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
