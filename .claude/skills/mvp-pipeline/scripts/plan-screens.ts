/**
 * プロトタイプの「生成対象の画面」を決め、各画面のプロンプトを書き出す。
 *
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/plan-screens.ts <projectDir> [画面名 ...]
 *
 * 画面名を指定すると**その画面だけ**を再生成対象にする（他は既存の .jsx を再利用）。
 * 親メニューの名前を指定すると配下のリーフも対象になる。未生成の画面は常に対象。
 *
 * 出力:
 *   <projectDir>/prototype/plan.json          … 画面一覧・ナビ・再生成対象（assemble.ts が読む）
 *   <projectDir>/prototype/prompts/<i>.md     … 画面 i のプロンプト（mvp-screen が読む）
 *   <projectDir>/prototype/prompts/theme.md   … ブランド文脈（mvp-theme が読む）
 *
 * 画面の導出とプロンプト本文は本体（Web アプリ）と同じコードを使う。
 * ここが二重管理になると Claude Code 版の品質が本体からずれる。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildBaseContext,
  buildBrandContext,
  buildScreenContext,
} from "../../../../src/lib/prototype-ds/prompt";
import { deriveScreenUnits } from "../../../../src/lib/prototype-ds/screen-units";

const [projectDir, ...selectedArgs] = process.argv.slice(2);

if (!projectDir) {
  console.error(
    "usage: tsx .claude/skills/mvp-pipeline/scripts/plan-screens.ts <projectDir> [画面名 ...]",
  );
  process.exit(2);
}

const readJson = <T>(file: string, fallback: T): T => {
  const path = join(projectDir, file);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    console.error(`${path} を JSON として読めない: ${(e as Error).message}`);
    process.exit(1);
  }
};

const project = readJson<{ name?: string; summary?: string }>(
  "project.json",
  {},
);
const navigation = readJson<{ items?: NavItem[] }>(
  "artifacts/navigation.json",
  {},
).items;
const ooui = readJson<{ objects?: OouiObject[] }>("artifacts/ooui.json", {})
  .objects;
const scope = readJson<{ mvpStatement?: string; features?: Feature[] }>(
  "artifacts/scope.json",
  {},
);
const brand = readJson<Brand | null>("artifacts/brand.json", null);

interface NavItem {
  label: string;
  parent?: string | null;
  icon?: string | null;
  screenType?: string | null;
  targetObject?: string | null;
}
interface OouiObject {
  name: string;
  attributes?: { name?: string; label?: string }[] | null;
}
interface Feature {
  name: string;
  description?: string | null;
  includedInMvp?: boolean;
}
interface Brand {
  brandName?: string | null;
  tagline?: string | null;
  tone?: string[] | null;
  palette?: Record<string, string | null> | null;
}

if (!navigation?.length) {
  console.error(
    `${join(projectDir, "artifacts/navigation.json")} が無い（または items が空）。先に13工程を通すこと。`,
  );
  process.exit(1);
}

// 成果物 → プロトタイプ文脈の写像。Web 側は buildRefinePrototypeContext
// (src/lib/ai/project-context.ts) が DB 行から同じ形を作っている。
const context = {
  projectName: project.name ?? "",
  summary: project.summary ?? null,
  mvpStatement: scope.mvpStatement ?? null,
  oouiObjects: (ooui ?? []).map((o) => ({
    name: o.name,
    attributes: (o.attributes ?? []).map((at) => at.label ?? at.name ?? ""),
  })),
  scope: (scope.features ?? [])
    .filter((f) => f.includedInMvp)
    .map((f) => ({ name: f.name, description: f.description })),
  brand,
};

const { allNav, units, hasDetail } = deriveScreenUnits(
  navigation,
  context.projectName,
);
const baseContext = buildBaseContext(context, units);

const protoDir = join(projectDir, "prototype");
const promptsDir = join(protoDir, "prompts");
const screensDir = join(protoDir, "screens");
mkdirSync(promptsDir, { recursive: true });
mkdirSync(screensDir, { recursive: true });

// 再生成対象。画面名の指定が無ければ全画面。指定があれば「その画面 + 配下 + 未生成」。
const selected = selectedArgs.length ? new Set(selectedArgs) : null;
const unknownNames = selectedArgs.filter(
  (name) => !units.some((u) => u.label === name) && !allNav.some((n) => n.label === name),
);
if (unknownNames.length) {
  console.error(`存在しない画面名: ${unknownNames.join(", ")}`);
  console.error(`指定できるのは: ${units.map((u) => u.label).join(" / ")}`);
  process.exit(2);
}

const screens = units.map((unit, index) => {
  const sourceFile = join(screensDir, `${index}.jsx`);
  const regenerate =
    !existsSync(sourceFile) || // 未生成は必ず作る（破壊しない）
    selected === null || // 全再生成
    selected.has(unit.label) ||
    (unit.parent != null && selected.has(unit.parent)) ||
    // 一覧が選ばれたら、その詳細画面も作り直す（内容が対になっているため）
    (unit.listLabel != null && selected.has(unit.listLabel));

  if (regenerate) {
    writeFileSync(
      join(promptsDir, `${index}.md`),
      `${buildScreenContext(baseContext, unit, hasDetail)}\n`,
    );
  }

  return {
    index,
    label: unit.label,
    parent: unit.parent ?? null,
    screenType: unit.screenType ?? null,
    targetObject: unit.targetObject ?? null,
    listLabel: unit.listLabel ?? null,
    regenerate,
  };
});

// テーマ: 基調色が無ければ生成しない（assemble.ts がブランドパレットから導出する）。
// 部分再生成で既存テーマがあるときも再利用する（配色の一貫性 + 生成時間の節約）。
const themeFile = join(protoDir, "theme.json");
const hasPrimary = !!brand?.palette?.primary;
const regenerateTheme =
  hasPrimary && (selected === null || !existsSync(themeFile));
if (regenerateTheme) {
  writeFileSync(join(promptsDir, "theme.md"), `${buildBrandContext(context)}\n`);
}

writeFileSync(
  join(protoDir, "plan.json"),
  `${JSON.stringify(
    {
      projectName: context.projectName || "プロトタイプ",
      // メニューは全項目(親子)で2階層描画。親はグループ見出し(画面なし)になる。
      nav: allNav.map((n) => ({
        label: n.label,
        parent: n.parent ?? null,
        icon: n.icon ?? null,
      })),
      brandPalette: brand?.palette ?? null,
      regenerateTheme,
      screens,
    },
    null,
    2,
  )}\n`,
);

// --- 呼び出し元（スキル）への指示 ----------------------------------------

const todo = screens.filter((s) => s.regenerate);
const reused = screens.length - todo.length;

console.log(`画面 ${screens.length} 件（生成 ${todo.length} / 再利用 ${reused}）`);
for (const s of screens) {
  console.log(
    `  ${s.regenerate ? "生成" : "再利用"} [${s.index}] ${s.label}${s.listLabel ? `（${s.listLabel}の詳細）` : ""}`,
  );
}
console.log(
  regenerateTheme
    ? "テーマ: 生成する（mvp-theme を1体起動）"
    : hasPrimary
      ? "テーマ: 既存の theme.json を再利用"
      : "テーマ: ブランドに基調色が無いためパレットから導出（エージェント不要）",
);

if (todo.length) {
  console.log(
    `\n次: mvp-screen を ${todo.length} 体、1メッセージでまとめて起動する。` +
      `各体に渡すのは「projectDir=${projectDir} / 画面番号=<i>」だけでよい。`,
  );
  console.log(`  画面番号: ${todo.map((s) => s.index).join(", ")}`);
}
console.log(
  `\nすべて揃ったら: pnpm exec tsx .claude/skills/mvp-pipeline/scripts/assemble.ts ${projectDir}`,
);
