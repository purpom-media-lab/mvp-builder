/**
 * daisyUI スキル（`.agents/skills/daisyui`）から、プロトタイプ生成プロンプトに注入する
 * キュレート済みリファレンスを生成して src/lib/prototype-ds/daisyui-reference.ts に書き出す。
 *
 * 再生成手順:
 *   1) npx -y skills add saadeghi/daisyui   （.agents/skills/daisyui を用意）
 *   2) pnpm exec tsx scripts/gen-daisyui-reference.ts
 *
 * 生成物（daisyui-reference.ts）はバンドルされるので、アプリ実行時にファイル/ネットワーク
 * 依存なしでプロンプトに使える。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SKILL = ".agents/skills/daisyui";

function read(p: string): string {
  const full = join(SKILL, p);
  return existsSync(full) ? readFileSync(full, "utf8").trim() : "";
}

// 公式スキルの「全コンポーネント」を取り込む（saadeghi/daisyui の components/*.md）。
// install/config（@plugin によるテーマ定義）は CDN 構成では使えず、テーマは
// generate-theme.ts + shell.ts で別管理するため、ここには含めない。
const componentDir = join(SKILL, "components");
const COMPONENTS = existsSync(componentDir)
  ? readdirSync(componentDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort()
  : [];

const parts: string[] = [];

// セマンティック選択ガイド（公式 SKILL.md の discovery protocol を要約）。
parts.push(
  [
    "# daisyUI 5 リファレンス（公式スキル全文）",
    "daisyUI 5 は Tailwind CSS 4 用の CSS ライブラリ。共通UIコンポーネントのクラス名・セマンティックカラー・テーマを提供する。",
    "",
    "## コンポーネント選定（semantic matching 必須）",
    "- 文言ではなく「意図・振る舞い・形」で最適なコンポーネントを選ぶ。名前が違っても最適なことがある。",
    "- 下記の各コンポーネント仕様（クラス名・修飾子・構造）に厳密に従う。勝手なクラス名を作らない。",
    `- 利用可能コンポーネント: ${COMPONENTS.join(", ")}`,
  ].join("\n"),
);

const usage = read("usage/SKILL.md");
if (usage) parts.push(usage);
const colors = read("colors/SKILL.md");
if (colors) parts.push(colors);

parts.push("## components reference");
for (const c of COMPONENTS) {
  const md = read(`components/${c}.md`);
  if (md) parts.push(md);
}

const content = parts.join("\n\n");

const out = `/**
 * 自動生成: daisyUI 5 公式スキル（saadeghi/daisyui, version 5.5.x）の全コンポーネント
 * リファレンス。生成元: scripts/gen-daisyui-reference.ts（手で編集しない）。
 *
 * 再生成: npx -y skills add saadeghi/daisyui && pnpm exec tsx scripts/gen-daisyui-reference.ts
 */
export const DAISYUI_REFERENCE = ${JSON.stringify(content)};
`;

writeFileSync("src/lib/prototype-ds/daisyui-reference.ts", out);
console.log(
  `wrote src/lib/prototype-ds/daisyui-reference.ts (${content.length} chars, ${COMPONENTS.length} components)`,
);
