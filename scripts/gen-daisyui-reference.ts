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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILL = ".agents/skills/daisyui";
// プロトタイプ画面でよく使うコンポーネントに絞る（全70個は入れない）。
const COMPONENTS = [
  "button",
  "card",
  "badge",
  "alert",
  "table",
  "stat",
  "menu",
  "navbar",
  "drawer",
  "tab",
  "input",
  "textarea",
  "select",
  "fieldset",
  "label",
  "checkbox",
  "radio",
  "toggle",
  "modal",
  "dropdown",
  "divider",
  "loading",
  "progress",
  "breadcrumbs",
  "avatar",
  "list",
  "steps",
  "join",
  "link",
  "footer",
];

function read(p: string): string {
  const full = join(SKILL, p);
  return existsSync(full) ? readFileSync(full, "utf8").trim() : "";
}

const parts: string[] = [];
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
 * 自動生成: daisyUI 5 スキルのキュレート版リファレンス。
 * 生成元: scripts/gen-daisyui-reference.ts（手で編集しない）。
 */
export const DAISYUI_REFERENCE = ${JSON.stringify(content)};
`;

writeFileSync("src/lib/prototype-ds/daisyui-reference.ts", out);
console.log(
  `wrote src/lib/prototype-ds/daisyui-reference.ts (${content.length} chars, ${COMPONENTS.length} components)`,
);
