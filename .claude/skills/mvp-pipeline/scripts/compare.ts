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

const [projectDir] = process.argv.slice(2);
if (!projectDir) {
  console.error(
    "usage: tsx .claude/skills/mvp-pipeline/scripts/compare.ts <projectDir>",
  );
  process.exit(2);
}

const refPath = join(projectDir, "reference", "project.json");
if (!existsSync(refPath)) {
  console.error(`リファレンスが無い: ${refPath}（先に fetch-reference.ts を実行）`);
  process.exit(2);
}
const ref = JSON.parse(readFileSync(refPath, "utf8"));

function art(step: string): unknown {
  const p = join(projectDir, "artifacts", `${step}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
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
  ["actors", (ref.actors ?? []).length, (art("actors") as { actors?: [] })?.actors?.length ?? 0],
  ["useCases", (ref.useCases ?? []).length, (art("usecases") as { useCases?: [] })?.useCases?.length ?? 0],
  ["ooui objects", (ref.ooui ?? []).length, (art("ooui") as { objects?: [] })?.objects?.length ?? 0],
  ["journeys", (ref.journey ?? []).length, (art("journey") as { journeys?: [] })?.journeys?.length ?? 0],
  ["competitors", (ref.market?.competitors ?? []).length, (art("market") as { competitors?: [] })?.competitors?.length ?? 0],
  ["navigation", (ref.navigation ?? []).length, (art("navigation") as { items?: [] })?.items?.length ?? 0],
  ["wireframes", (ref.wireframes ?? []).length, (art("wireframe") as { screens?: [] })?.screens?.length ?? 0],
  ["dataModel", (ref.dataModel ?? []).length, (art("datamodel") as { entities?: [] })?.entities?.length ?? 0],
  ["scope features", (ref.scope ?? []).length, (art("scope") as { features?: [] })?.features?.length ?? 0],
  ["supporting KPI", (ref.kpi?.supporting ?? []).length, (art("kpi") as { supporting?: [] })?.supporting?.length ?? 0],
];
console.log("\n## 件数\n| 項目 | 本体 | CC |\n| --- | --- | --- |");
for (const [k, a, b] of counts) console.log(`| ${k} | ${a} | ${b} |`);

// --- 名前集合 -----------------------------------------------------------
setDiff("アクター", names(ref.actors, "name"), names((art("actors") as { actors?: [] })?.actors, "name"));
setDiff("OOUI メインオブジェクト", names(ref.ooui, "name"), names((art("ooui") as { objects?: [] })?.objects, "name"));
setDiff("ナビゲーション項目", names(ref.navigation, "label"), names((art("navigation") as { items?: [] })?.items, "label"));
setDiff("データエンティティ", names(ref.dataModel, "name"), names((art("datamodel") as { entities?: [] })?.entities, "name"));

const refMvp = (ref.scope ?? []).filter((f: { includedInMvp?: boolean }) => f.includedInMvp);
const ccScope = art("scope") as { features?: { name: string; includedInMvp?: boolean }[]; mvpStatement?: string } | null;
const ccMvp = (ccScope?.features ?? []).filter((f) => f.includedInMvp);
setDiff("MVPに含む機能", names(refMvp, "name"), names(ccMvp, "name"));

// --- 判断の一致 ---------------------------------------------------------
const refBe = ref.backend ?? {};
const ccBe = (art("backend") as Record<string, unknown>) ?? {};
console.log("\n## バックエンド要否判定\n| 項目 | 本体 | CC | 一致 |\n| --- | --- | --- | --- |");
for (const k of ["needsAuth", "needsStorage", "needsDb"]) {
  const a = refBe[k];
  const b = ccBe[k];
  console.log(`| ${k} | ${a} | ${b} | ${a === b ? "✓" : "✗"} |`);
}
console.log(`| externalApis | ${(refBe.externalApis ?? []).join(", ")} | ${((ccBe.externalApis as string[]) ?? []).join(", ")} | |`);

console.log("\n## 北極星指標");
console.log(`  本体: ${ref.kpi?.northStar?.name ?? "—"}（目標: ${ref.kpi?.northStar?.target ?? "—"}）`);
const ccKpi = art("kpi") as { northStar?: { name?: string; target?: string } } | null;
console.log(`  CC  : ${ccKpi?.northStar?.name ?? "—"}（目標: ${ccKpi?.northStar?.target ?? "—"}）`);

console.log("\n## MVPステートメント");
console.log(`  本体: ${ref.mvpStatement ?? "—"}`);
console.log(`  CC  : ${ccScope?.mvpStatement ?? "—"}`);

console.log("\n## 市場規模（TAM/SAM/SOM）");
const ccMarket = art("market") as { marketSize?: Record<string, string> } | null;
for (const k of ["tam", "sam", "som"]) {
  console.log(`  ${k.toUpperCase()} 本体: ${ref.market?.marketSize?.[k] ?? "—"}`);
  console.log(`  ${k.toUpperCase()} CC  : ${ccMarket?.marketSize?.[k] ?? "—"}`);
}
