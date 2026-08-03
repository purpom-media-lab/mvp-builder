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
} from "../../../../src/lib/prototype-ds/shell";
import { themeSchema } from "../../../../src/lib/prototype-ds/theme-spec";
import type { Plan } from "./plan-screens";
import { formatZodIssues, SCRIPTS, usage } from "./_lib";

const PLAN_SCREENS = `${SCRIPTS}/plan-screens.ts`;

const [projectDir] = process.argv.slice(2);

if (!projectDir) {
  console.error(usage("assemble.ts", "<projectDir>"));
  process.exit(2);
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

/** 使えなかった画面。理由つきで1本にまとめる（報告と再生成コマンドの両方に使う）。 */
const failures: {
  index: number;
  label: string;
  reason: "未生成" | "壊れている";
}[] = [];

const screens = plan.screens.map((s) => {
  const componentName = `Screen${s.index}`;
  const file = join(protoDir, "screens", `${s.index}.jsx`);
  const raw = existsSync(file) ? readFileSync(file, "utf8") : null;
  // サブエージェントの出力は信用しない。関数名の採番・コードフェンス除去・
  // 括弧バランス検査を必ず通し、通らなければプレースホルダに落として全体を守る。
  const source = raw === null ? null : sanitizeScreen(raw, componentName);

  if (source === null) {
    failures.push({
      index: s.index,
      label: s.label,
      reason: raw === null ? "未生成" : "壊れている",
    });
  }

  return {
    label: s.label,
    componentName,
    source: source ?? placeholder(componentName, s.label),
    failed: source === null,
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
      for (const line of formatZodIssues(parsed.error.issues, { withCode: false })) {
        console.warn(line);
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
  screens,
});

const out = join(protoDir, "index.html");
writeFileSync(out, html);

// --- 報告 -----------------------------------------------------------------

console.log(`${out} (${html.length.toLocaleString()} 文字)`);
console.log(
  `画面 ${screens.length} 件中 ${screens.length - failures.length} 件が有効 / テーマ: ${themeSource}`,
);
for (const reason of ["未生成", "壊れている"] as const) {
  const hit = failures.filter((f) => f.reason === reason);
  if (hit.length) {
    console.log(
      `${reason}: ${hit.map((f) => `[${f.index}] ${f.label}`).join(", ")}`,
    );
  }
}
if (failures.length) {
  console.log(
    `\n該当画面はプレースホルダで埋めた。作り直すには:\n` +
      `  pnpm exec tsx ${PLAN_SCREENS} ${projectDir} ${failures
        .map((f) => `"${f.label}"`)
        .join(" ")}`,
  );
}
