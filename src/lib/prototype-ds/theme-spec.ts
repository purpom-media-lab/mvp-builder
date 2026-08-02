/**
 * daisyUI 5 テーマ生成の仕様（system プロンプト + 出力スキーマ）。
 *
 * 依存は zod のみ。Web アプリ（generate-theme）、Claude Code 版の生成スクリプト
 * （scripts/gen-claude-skill.ts）、CC 側の組み立て（assemble.ts）の3系統が参照する。
 * step-specs.ts と同じ「仕様は1箇所・実行は別」の作法。
 */
import { z } from "zod";

const hex = z
  .string()
  .describe("HEXカラー #rrggbb 形式")
  .regex(/^#[0-9a-fA-F]{6}$/);

export const themeSchema = z.object({
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
  radius: z.enum(["0rem", "0.25rem", "0.5rem", "1rem"]).describe("角丸の基調"),
  depth: z.union([z.literal(0), z.literal(1)]).describe("立体感 0/1"),
});

export const THEME_SYSTEM = `あなたは UI のカラーシステム設計の専門家です。ブランド情報から daisyUI 5 の完全なライトテーマを設計します。

ルール（daisyUI 公式準拠）:
- ブランドの基調色を primary に置く。secondary / accent は primary と調和する補色・近似色にする。
- *-content（primary-content など）は、その背景色の上で読みやすいよう **十分なコントラスト**（明るい背景→濃い文字、濃い背景→明るい文字）にする。
- base-100/200/300 はページの大半に使う面色。base-100 を最も明るく、200→300 と少しずつ濃く。ライトテーマなので base-100 はほぼ白〜淡色。base-content は base-100 上で読める濃い色。
- info=青系 / success=緑系 / warning=黄〜橙系 / error=赤系 を、ブランドトーンに馴染む彩度で。
- 全体に統一感・アクセシブルな配色。奇抜にしすぎない。
- 値はすべて #rrggbb の HEX。`;
