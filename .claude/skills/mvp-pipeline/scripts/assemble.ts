/**
 * 生成された画面とテーマを、本体と同じ骨格で単一 HTML に組み立てる。
 *
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/assemble.ts <projectDir>
 *
 * 入力:
 *   <projectDir>/prototype/plan.json        … plan-screens.ts の出力
 *   <projectDir>/prototype/screens/<i>.jsx  … mvp-screen の出力
 *   <projectDir>/prototype/theme.json       … mvp-theme の出力（任意）
 * 出力:
 *   <projectDir>/prototype/index.html
 *
 * サニタイズ（関数名の採番・コードフェンス除去・括弧バランス検査）は**必ずここで**行う。
 * サブエージェントの出力を信用せず、壊れていればプレースホルダに落として全体を守る
 * — 本体（generateScreenComponent）と同じ考え方。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  placeholder,
  sanitizeScreen,
} from "../../../../src/lib/prototype-ds/sanitize";
import {
  buildDsHtml,
  paletteToTheme,
  type DaisyTheme,
  type DsBrandPalette,
} from "../../../../src/lib/prototype-ds/shell";
import { themeSchema } from "../../../../src/lib/prototype-ds/theme-spec";

const [projectDir] = process.argv.slice(2);

if (!projectDir) {
  console.error(
    "usage: tsx .claude/skills/mvp-pipeline/scripts/assemble.ts <projectDir>",
  );
  process.exit(2);
}

interface Plan {
  projectName: string;
  nav: { label: string; parent: string | null; icon: string | null }[];
  brandPalette: DsBrandPalette | null;
  screens: {
    index: number;
    label: string;
    parent: string | null;
    listLabel: string | null;
  }[];
}

const protoDir = join(projectDir, "prototype");
const planFile = join(protoDir, "plan.json");

if (!existsSync(planFile)) {
  console.error(
    `${planFile} が無い。先に plan-screens.ts を実行して画面を確定すること。`,
  );
  process.exit(1);
}

const plan = JSON.parse(readFileSync(planFile, "utf8")) as Plan;

// --- 画面 -----------------------------------------------------------------

const missing: string[] = [];
const broken: string[] = [];

const screens = plan.screens.map((s) => {
  const componentName = `Screen${s.index}`;
  const file = join(protoDir, "screens", `${s.index}.jsx`);

  if (!existsSync(file)) {
    missing.push(`[${s.index}] ${s.label}`);
    return {
      label: s.label,
      componentName,
      source: placeholder(componentName, s.label),
      failed: true,
      parent: s.parent,
    };
  }

  const source = sanitizeScreen(readFileSync(file, "utf8"), componentName);
  if (!source) {
    broken.push(`[${s.index}] ${s.label}`);
    return {
      label: s.label,
      componentName,
      source: placeholder(componentName, s.label),
      failed: true,
      parent: s.parent,
    };
  }

  return {
    label: s.label,
    componentName,
    source,
    failed: false,
    parent: s.parent,
  };
});

// --- テーマ ---------------------------------------------------------------

const themeFile = join(protoDir, "theme.json");
let theme: DaisyTheme | null = null;
let themeSource = "ブランドパレットから導出";

if (existsSync(themeFile)) {
  try {
    const parsed = themeSchema.safeParse(
      JSON.parse(readFileSync(themeFile, "utf8")),
    );
    if (parsed.success) {
      theme = parsed.data as DaisyTheme;
      themeSource = "theme.json";
    } else {
      console.warn(`⚠ theme.json がスキーマ不一致のため使わない:`);
      for (const issue of parsed.error.issues) {
        const path = issue.path.length ? issue.path.join(".") : "(root)";
        console.warn(`  - ${path}: ${issue.message}`);
      }
    }
  } catch (e) {
    console.warn(`⚠ theme.json を JSON として読めない: ${(e as Error).message}`);
  }
}
if (!theme && plan.brandPalette) {
  theme = paletteToTheme(plan.brandPalette);
}

// --- 組み立て -------------------------------------------------------------

const html = buildDsHtml({
  projectName: plan.projectName,
  theme,
  brand: plan.brandPalette ? { palette: plan.brandPalette } : null,
  nav: plan.nav,
  screens: screens.map((s) => ({
    label: s.label,
    componentName: s.componentName,
    source: s.source,
    failed: s.failed,
  })),
});

const out = join(protoDir, "index.html");
writeFileSync(out, html);

// --- 報告 -----------------------------------------------------------------

const failed = screens.filter((s) => s.failed);
console.log(`${out} (${html.length.toLocaleString()} 文字)`);
console.log(
  `画面 ${screens.length} 件中 ${screens.length - failed.length} 件が有効 / テーマ: ${themeSource}`,
);
if (missing.length) console.log(`未生成: ${missing.join(", ")}`);
if (broken.length) {
  console.log(`壊れている（関数の形でない・括弧が閉じていない）: ${broken.join(", ")}`);
}
if (failed.length) {
  console.log(
    `\n該当画面はプレースホルダで埋めた。作り直すには:\n` +
      `  pnpm exec tsx .claude/skills/mvp-pipeline/scripts/plan-screens.ts ${projectDir} ${failed
        .map((s) => `"${s.label}"`)
        .join(" ")}`,
  );
}
process.exit(0);
