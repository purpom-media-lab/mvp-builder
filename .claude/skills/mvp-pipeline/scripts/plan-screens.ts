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
import {
  deriveScreenUnits,
  shouldRegenerateScreen,
} from "../../../../src/lib/prototype-ds/screen-units";
import type { DsBrandPalette } from "../../../../src/lib/prototype-ds/shell";
import { usage } from "./_lib";
import type { z } from "zod";
import type {
  brandSchema,
  navigationSchema,
  oouiSchema,
  scopeSchema,
} from "../../../../src/lib/ai/schemas";

const [projectDir, ...selectedArgs] = process.argv.slice(2);

if (!projectDir) {
  console.error(usage("plan-screens.ts", "<projectDir> [画面名 ...]"));
  process.exit(2);
}

// 成果物の形は本体の zod スキーマがそのまま正。手で写すと必ずずれる。
type Navigation = z.infer<typeof navigationSchema>;
type Ooui = z.infer<typeof oouiSchema>;
type Scope = z.infer<typeof scopeSchema>;
type Brand = z.infer<typeof brandSchema>;
type Project = { name?: string; summary?: string };

/**
 * `<projectDir>/prototype/plan.json` の形。assemble.ts がこれを読む。
 * 受け渡しの契約なので、書き手（ここ）が型の正とする。
 */
export interface Plan {
  projectName: string;
  /** メニュー全項目（親子・順序つき）。画面を持たない親も含む。 */
  nav: { label: string; parent: string | null; icon: string | null }[];
  brandPalette: DsBrandPalette | null;
  screens: {
    index: number;
    label: string;
    /** 詳細画面のとき、対応する一覧のラベル */
    listLabel: string | null;
    /** この実行で作り直す対象か（進捗表示用。assemble は見ない） */
    regenerate: boolean;
  }[];
}

/** `<projectDir>/<file>` を読む。無ければ null、壊れていれば異常終了。 */
const readJson = <T>(file: string): T | null => {
  const path = join(projectDir, file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    console.error(`${path} を JSON として読めない: ${(e as Error).message}`);
    process.exit(1);
  }
};

const project = readJson<Project>("project.json");
const navigation = readJson<Navigation>("artifacts/navigation.json")?.items;
const ooui = readJson<Ooui>("artifacts/ooui.json")?.objects;
const scope = readJson<Scope>("artifacts/scope.json");
const brand = readJson<Brand>("artifacts/brand.json");

if (!navigation?.length) {
  console.error(
    `${join(projectDir, "artifacts/navigation.json")} が無い（または items が空）。先に13工程を通すこと。`,
  );
  process.exit(1);
}

// 成果物 → プロトタイプ文脈の写像。Web 側の DS プロトタイプ経路
// (src/app/studio/[id]/prototype/page.tsx の payload) と同じ形にする。
//
// scope は includedInMvp で**絞らない**。プロトタイプは探索用で、
// buildBaseContext が「MVPに絞り込まず、全ユースケース・全画面を網羅的に」と
// 指示している以上、渡す機能一覧を絞ると指示と矛盾する
// （絞るのは generateDesignBrief 用の buildRefinePrototypeContext のほう）。
const context = {
  projectName: project?.name ?? "",
  summary: project?.summary ?? null,
  mvpStatement: scope?.mvpStatement ?? null,
  oouiObjects: (ooui ?? []).map((o) => ({
    name: o.name,
    attributes: (o.attributes ?? []).map((at) => at.label ?? at.name ?? ""),
  })),
  scope: (scope?.features ?? []).map((f) => ({
    name: f.name,
    description: f.description,
  })),
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

// 再生成対象。画面名の指定が無ければ全画面。
// 指定できるのは「メニュー項目（画面を持たない親も含む）」と「補完した詳細画面」。
const selectableNames = new Set([...allNav, ...units].map((x) => x.label));
const unknownNames = selectedArgs.filter((n) => !selectableNames.has(n));
if (unknownNames.length) {
  console.error(`存在しない画面名: ${unknownNames.join(", ")}`);
  console.error(`指定できるのは: ${[...selectableNames].join(" / ")}`);
  process.exit(2);
}
const selected = selectedArgs.length ? new Set(selectedArgs) : null;

// 前回の割り当て（index → ラベル）。ソースは `screens/<index>.jsx` に index で
// 保存しているが、index はナビ順に依存するので、navigation を作り直すと同じ index が
// 別の画面を指すようになる。前回と同じラベルのときだけ再利用してよい
// （本体はラベルをキーに保存しているのでこの問題がない）。
const prevPlan = readJson<Plan>("prototype/plan.json");
const prevLabelAt = new Map(
  (prevPlan?.screens ?? []).map((s) => [s.index, s.label]),
);

const screens = units.map((unit, index) => {
  // 「作り直すか」の判定は本体（jobs-runner）と同じ関数を使う。
  // 既存ソースが「この画面のもの」と言えるのは、前回も同じ index が同じラベルだったときだけ。
  const reusable =
    prevLabelAt.get(index) === unit.label &&
    existsSync(join(screensDir, `${index}.jsx`));
  const regenerate = shouldRegenerateScreen(unit, selected, () => reusable);
  if (regenerate) {
    writeFileSync(
      join(promptsDir, `${index}.md`),
      `${buildScreenContext(baseContext, unit, hasDetail)}\n`,
    );
  }
  return {
    index,
    label: unit.label,
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

const plan: Plan = {
  projectName: context.projectName || "プロトタイプ",
  // メニューは全項目(親子)で2階層描画。親はグループ見出し(画面なし)になる。
  nav: allNav.map((n) => ({
    label: n.label,
    parent: n.parent ?? null,
    icon: n.icon ?? null,
  })),
  brandPalette: brand?.palette ?? null,
  screens,
};
writeFileSync(
  join(protoDir, "plan.json"),
  `${JSON.stringify(plan, null, 2)}\n`,
);

// --- 呼び出し元（スキル）への指示 ----------------------------------------

const todo = screens.filter((s) => s.regenerate);

console.log(
  `画面 ${screens.length} 件（生成 ${todo.length} / 再利用 ${screens.length - todo.length}）`,
);
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
