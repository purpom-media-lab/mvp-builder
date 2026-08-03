/**
 * Claude Code 版パイプラインの出力を、MVP Builder（Web アプリ）本体の出力と突き合わせる。
 *
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/compare.ts <projectDir>
 *
 * 前提: fetch-reference.ts で <projectDir>/reference/project.json を取得済みであること。
 *
 * 出力するのは「構造の差」だけ。どちらが妥当かは判定しない（人間／呼び出し元の Claude が読む）。
 *
 * 既知の限界: 名前集合の比較は**完全一致**。「対応スタッフ」と「事務所スタッフ」、
 * 「AI一次回答」と「AI一次回答案」のような表記ゆれは別物として数えられる。
 * 「一致 0」でも中身は同じことがあるので、件数と併せて中身を読むこと。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { usage } from "./_lib";

const [projectDir] = process.argv.slice(2);
if (!projectDir) {
  console.error(usage("compare.ts", "<projectDir>"));
  process.exit(2);
}

const refPath = join(projectDir, "reference", "project.json");
if (!existsSync(refPath)) {
  console.error(`リファレンスが無い: ${refPath}（先に fetch-reference.ts を実行）`);
  process.exit(2);
}
const ref = JSON.parse(readFileSync(refPath, "utf8"));

const artCache = new Map<string, Record<string, unknown> | null>();

/** CC 版の成果物 `<step>.json`（無ければ null）。同じ工程は 1 度しか読まない。 */
function art(step: string): Record<string, unknown> | null {
  if (!artCache.has(step)) {
    const p = join(projectDir, "artifacts", `${step}.json`);
    artCache.set(
      step,
      existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null,
    );
  }
  return artCache.get(step) ?? null;
}

/**
 * CC 版の成果物から配列プロパティを取り出す（例: `ccList("ooui", "objects")`）。
 * 比較項目を足すたびにキャストを書き写さないための入口。
 */
function ccList(step: string, key: string): Record<string, unknown>[] {
  const v = art(step)?.[key];
  return Array.isArray(v) ? v : [];
}

/** 2つの名前集合を「共通 / 本体のみ / CC のみ」に分ける。 */
function setDiff(label: string, refNames: string[], ccNames: string[]) {
  const r = new Set(refNames);
  const c = new Set(ccNames);
  const both = [...r].filter((x) => c.has(x));
  const onlyRef = [...r].filter((x) => !c.has(x));
  const onlyCc = [...c].filter((x) => !r.has(x));
  console.log(`\n## ${label}  (本体 ${r.size} / CC ${c.size} / 一致 ${both.length})`);
  if (both.length) console.log(`  一致    : ${both.join(" , ")}`);
  if (onlyRef.length) console.log(`  本体のみ: ${onlyRef.join(" , ")}`);
  if (onlyCc.length) console.log(`  CCのみ  : ${onlyCc.join(" , ")}`);
}

const names = (xs: unknown, key: string): string[] =>
  Array.isArray(xs)
    ? xs.map((x) => String((x as Record<string, unknown>)?.[key] ?? "")).filter(Boolean)
    : [];

console.log(`# 比較: ${ref.project?.name ?? projectDir}`);

// --- 件数 ---------------------------------------------------------------
const counts: [string, number, number][] = [
  ["actors", (ref.actors ?? []).length, ccList("actors", "actors").length],
  ["useCases", (ref.useCases ?? []).length, ccList("usecases", "useCases").length],
  ["ooui objects", (ref.ooui ?? []).length, ccList("ooui", "objects").length],
  ["journeys", (ref.journey ?? []).length, ccList("journey", "journeys").length],
  ["competitors", (ref.market?.competitors ?? []).length, ccList("market", "competitors").length],
  ["navigation", (ref.navigation ?? []).length, ccList("navigation", "items").length],
  ["wireframes", (ref.wireframes ?? []).length, ccList("wireframe", "screens").length],
  ["dataModel", (ref.dataModel ?? []).length, ccList("datamodel", "entities").length],
  ["scope features", (ref.scope ?? []).length, ccList("scope", "features").length],
  ["supporting KPI", (ref.kpi?.supporting ?? []).length, ccList("kpi", "supporting").length],
];
console.log("\n## 件数\n| 項目 | 本体 | CC |\n| --- | --- | --- |");
for (const [k, a, b] of counts) console.log(`| ${k} | ${a} | ${b} |`);

// --- 名前集合 -----------------------------------------------------------
setDiff("アクター", names(ref.actors, "name"), names(ccList("actors", "actors"), "name"));
setDiff("OOUI メインオブジェクト", names(ref.ooui, "name"), names(ccList("ooui", "objects"), "name"));
setDiff("ナビゲーション項目", names(ref.navigation, "label"), names(ccList("navigation", "items"), "label"));
setDiff("データエンティティ", names(ref.dataModel, "name"), names(ccList("datamodel", "entities"), "name"));

const refMvp = (ref.scope ?? []).filter((f: { includedInMvp?: boolean }) => f.includedInMvp);
const ccMvp = ccList("scope", "features").filter((f) => f.includedInMvp);
setDiff("MVPに含む機能", names(refMvp, "name"), names(ccMvp, "name"));

// --- 判断の一致 ---------------------------------------------------------
const refBe = ref.backend ?? {};
const ccBe = art("backend") ?? {};
console.log("\n## バックエンド要否判定\n| 項目 | 本体 | CC | 一致 |\n| --- | --- | --- | --- |");
for (const k of ["needsAuth", "needsStorage", "needsDb"]) {
  const a = refBe[k];
  const b = ccBe[k];
  console.log(`| ${k} | ${a} | ${b} | ${a === b ? "✓" : "✗"} |`);
}
console.log(`| externalApis | ${(refBe.externalApis ?? []).join(", ")} | ${((ccBe.externalApis as string[]) ?? []).join(", ")} | |`);

console.log("\n## 北極星指標");
console.log(`  本体: ${ref.kpi?.northStar?.name ?? "—"}（目標: ${ref.kpi?.northStar?.target ?? "—"}）`);
const ccNorthStar = art("kpi")?.northStar as
  | { name?: string; target?: string }
  | undefined;
console.log(`  CC  : ${ccNorthStar?.name ?? "—"}（目標: ${ccNorthStar?.target ?? "—"}）`);

console.log("\n## MVPステートメント");
console.log(`  本体: ${ref.mvpStatement ?? "—"}`);
console.log(`  CC  : ${art("scope")?.mvpStatement ?? "—"}`);

console.log("\n## 市場規模（TAM/SAM/SOM）");
const ccMarketSize = art("market")?.marketSize as
  | Record<string, string>
  | undefined;
for (const k of ["tam", "sam", "som"]) {
  console.log(`  ${k.toUpperCase()} 本体: ${ref.market?.marketSize?.[k] ?? "—"}`);
  console.log(`  ${k.toUpperCase()} CC  : ${ccMarketSize?.[k] ?? "—"}`);
}
