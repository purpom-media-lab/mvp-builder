/**
 * エージェントが書いた baseline の部品をまとめて検証する。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/baseline-merge.ts <profileId>
 *
 * - parts/wireframe-<i>.json を artifacts/wireframe.json にまとめる
 *   （各画面の sourceFile は screen-sources.json に分けて残し、成果物からは外す）
 * - navigation / wireframe / datamodel / theme を 13 工程と同じ zod スキーマで検証する
 * - 工程間の整合（ナビの画面にワイヤーがあるか、画面名の重複）を確かめる
 * - 結果を status.json に書く
 *
 * 1 件でも不正なら exit 1。足りない batch と直し方を出す。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataModelSchema, navigationSchema, wireframeSchema } from "../../../../src/lib/ai/schemas";
import { themeSchema } from "../../../../src/lib/prototype-ds/theme-spec";
import { formatZodIssues } from "../../mvp-pipeline/scripts/_lib";
import { baselineDir, loadProfile, usage } from "./_profile";

const profileId = process.argv[2];
if (!profileId) {
  console.error(usage("baseline-merge.ts", "<profileId>"));
  process.exit(2);
}
const profile = loadProfile(profileId);
const dir = baselineDir(profile.id);
const read = (rel: string): unknown => JSON.parse(readFileSync(join(dir, rel), "utf8"));

let errors = 0;
const warnings: string[] = [];
const fail = (msg: string) => {
  errors++;
  console.log(`INVALID  ${msg}`);
};

// ---------------------------------------------------------------- wireframe parts
const expected = readdirSync(join(dir, "prompts"))
  .map((f) => f.match(/^screens-(\d+)\.md$/)?.[1])
  .filter((x): x is string => !!x)
  .map(Number)
  .sort((a, b) => a - b);

type Screen = { screenName: string; sourceFile?: string | string[] } & Record<string, unknown>;
const screens: Screen[] = [];
const sources: Record<string, string[]> = {};
const missingParts: number[] = [];

for (const i of expected) {
  const rel = `parts/wireframe-${i}.json`;
  if (!existsSync(join(dir, rel))) {
    missingParts.push(i);
    continue;
  }
  let part: { screens?: Screen[] };
  try {
    part = read(rel) as { screens?: Screen[] };
  } catch (e) {
    fail(`${rel} — JSON として読めない: ${(e as Error).message}`);
    continue;
  }
  const r = wireframeSchema.safeParse(part);
  if (!r.success) {
    fail(`${rel}\n${formatZodIssues(r.error.issues).join("\n")}`);
    continue;
  }
  for (const s of part.screens ?? []) {
    const files = [s.sourceFile ?? []].flat();
    if (!files.length) warnings.push(`${rel}: 「${s.screenName}」に sourceFile が無い`);
    if (sources[s.screenName]) {
      warnings.push(
        `画面名の重複: 「${s.screenName}」（${sources[s.screenName].join(", ")} と ${files.join(", ")}）。後のものを捨てた`,
      );
      sources[s.screenName].push(...files);
      continue;
    }
    sources[s.screenName] = files;
    const { sourceFile: _drop, ...rest } = s;
    screens.push(rest as Screen);
  }
}

if (missingParts.length) {
  fail(
    `ワイヤーの batch が足りない: ${missingParts.join(", ")}\n  → その番号の mvp-baseline-screens を起動し直す`,
  );
}

const wireframe = { screens };
writeFileSync(join(dir, "artifacts/wireframe.json"), `${JSON.stringify(wireframe, null, 2)}\n`);
writeFileSync(join(dir, "screen-sources.json"), `${JSON.stringify(sources, null, 2)}\n`);

// ---------------------------------------------------------------- 各成果物の検証
const checks = [
  ["artifacts/navigation.json", navigationSchema],
  ["artifacts/wireframe.json", wireframeSchema],
  ["artifacts/datamodel.json", dataModelSchema],
  ["prototype/theme.json", themeSchema],
] as const;

for (const [rel, schema] of checks) {
  if (!existsSync(join(dir, rel))) {
    fail(`${rel} — 無い`);
    continue;
  }
  const r = schema.safeParse(read(rel));
  if (!r.success) fail(`${rel}\n${formatZodIssues(r.error.issues).join("\n")}`);
  else console.log(`OK       ${rel}`);
}

// ---------------------------------------------------------------- 工程間の整合
type NavItem = { label: string; screenType: string; parent: string | null };
const nav = existsSync(join(dir, "artifacts/navigation.json"))
  ? ((read("artifacts/navigation.json") as { items: NavItem[] }).items ?? [])
  : [];
const parents = new Set(nav.map((n) => n.parent).filter(Boolean));
const names = new Set(screens.map((s) => s.screenName));
const navLeaves = nav.filter((n) => !parents.has(n.label));
const uncovered = navLeaves.filter((n) => !names.has(n.label)).map((n) => n.label);
if (uncovered.length) {
  warnings.push(
    `ナビにあるのにワイヤーが無い画面 ${uncovered.length} 件: ${uncovered.join(" / ")}\n    → ページの画面名をナビの label に合わせるか、該当ページの batch を直す`,
  );
}
const offNav = screens.filter((s) => !nav.some((n) => n.label === s.screenName)).length;

const status = {
  profile: profile.id,
  mergedAt: new Date().toISOString(),
  ok: errors === 0,
  counts: {
    navItems: nav.length,
    navLeaves: navLeaves.length,
    screens: screens.length,
    screensNotInNav: offNav,
    navLeavesWithoutScreen: uncovered.length,
  },
  warnings,
};
writeFileSync(join(dir, "status.json"), `${JSON.stringify(status, null, 2)}\n`);

console.log("");
console.log(
  `ナビ ${nav.length} 項目（画面になるもの ${navLeaves.length}）／ワイヤー ${screens.length} 画面（うちナビ外 ${offNav}）`,
);
for (const w of warnings) console.log(`WARN     ${w}`);
if (errors) {
  console.log(`\n${errors} 件の不正。直してから再実行する`);
  process.exit(1);
}
console.log(`\nbaseline OK: ${dir}`);
