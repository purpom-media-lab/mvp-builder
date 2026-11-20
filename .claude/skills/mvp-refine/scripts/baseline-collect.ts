/**
 * 既存システムの baseline を作る前段（機械でできる部分）。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/baseline-collect.ts <profileId> [--batch 12]
 *
 * 出力（.mvp/<profile>/baseline/）:
 *   sources.json              … リポジトリ・コミット・参照したソース（古くなったかの判定に使う）
 *   artifacts/datamodel.json  … データモデル（prisma から機械で起こす。13 工程の datamodel と同じ形）
 *   entities-index.json       … エンティティ名と日本語のコメント（画面との対応付けに使う）
 *   prototype/theme.json      … モック用の daisyUI テーマ（MUI の色から機械で起こす）
 *   prompts/nav.md            … mvp-baseline-nav に渡す指示
 *   prompts/screens-<i>.md    … mvp-baseline-screens に渡す指示（ページを batch 件ずつ）
 *
 * AI が読む部分（ナビ・ワイヤー）はこのあと SKILL.md の手順でエージェントが行う。
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { dataModelSchema } from "../../../../src/lib/ai/schemas";
import { themeSchema } from "../../../../src/lib/prototype-ds/theme-spec";
import { baselineDir, git, loadProfile, sourcePaths, usage, type Profile } from "./_profile";

const args = process.argv.slice(2);
const profileId = args.find((a) => !a.startsWith("--"));
const batchIdx = args.indexOf("--batch");
const BATCH = batchIdx >= 0 ? Number(args[batchIdx + 1]) : 12;

if (!profileId || !Number.isFinite(BATCH) || BATCH < 1) {
  console.error(usage("baseline-collect.ts", "<profileId> [--batch 12]"));
  process.exit(2);
}

const profile = loadProfile(profileId);
const repo = profile.repoAbs;
const out = baselineDir(profile.id);
for (const d of ["artifacts", "prototype", "prompts", "parts"]) {
  mkdirSync(join(out, d), { recursive: true });
}
const write = (rel: string, data: unknown) =>
  writeFileSync(
    join(out, rel),
    typeof data === "string" ? data : `${JSON.stringify(data, null, 2)}\n`,
  );

// ---------------------------------------------------------------- sources
const commit = git(repo, "rev-parse", "HEAD");
const branch = git(repo, "rev-parse", "--abbrev-ref", "HEAD");
const dirty = git(repo, "status", "--porcelain", "--", ...sourcePaths(profile)) !== "";
write("sources.json", {
  profile: profile.id,
  repo,
  branch,
  commit,
  dirty,
  collectedAt: new Date().toISOString(),
  paths: sourcePaths(profile),
});

// ---------------------------------------------------------------- datamodel
interface Entity {
  name: string;
  fields: { name: string; type: string }[];
  relations: { to: string; type: string }[];
}

function parsePrisma(src: string): { entities: Entity[]; index: { name: string; comment: string | null; fields: number }[] } {
  const enums = new Set([...src.matchAll(/^enum\s+(\w+)/gm)].map((m) => m[1]));
  const models = new Set([...src.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]));
  const entities: Entity[] = [];
  const index: { name: string; comment: string | null; fields: number }[] = [];
  const lines = src.split("\n");
  let cur: Entity | null = null;
  let docs: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!cur) {
      if (line.startsWith("///")) {
        docs.push(line.replace(/^\/\/\/\s?/, ""));
        continue;
      }
      const m = line.match(/^model\s+(\w+)\s*\{/);
      if (m) {
        cur = { name: m[1], fields: [], relations: [] };
        index.push({ name: m[1], comment: docs.join(" ").slice(0, 200) || null, fields: 0 });
      }
      if (!line.startsWith("///")) docs = [];
      continue;
    }
    if (line === "}") {
      index[index.length - 1].fields = cur.fields.length;
      entities.push(cur);
      cur = null;
      continue;
    }
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const f = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/);
    if (!f) continue;
    const [, name, base, list, optional] = f;
    if (models.has(base)) {
      cur.relations.push({
        to: base,
        type: list ? "1対多（相手を複数持つ）" : optional ? "多対1（任意）" : "多対1",
      });
      continue;
    }
    const type = `${enums.has(base) ? `enum ${base}` : base}${list ? "[]" : ""}${optional ? "?" : ""}`;
    cur.fields.push({ name, type });
  }
  return { entities, index };
}

let entityCount = 0;
if (profile.sources.datamodel?.format === "prisma") {
  const src = readFileSync(join(repo, profile.sources.datamodel.path), "utf8");
  const { entities, index } = parsePrisma(src);
  const parsed = dataModelSchema.parse({ entities });
  write("artifacts/datamodel.json", parsed);
  write("entities-index.json", index);
  entityCount = entities.length;
}

// ---------------------------------------------------------------- theme
let themeNote = "なし";
if (profile.sources.theme?.format === "mui-colors-json") {
  const c = JSON.parse(readFileSync(join(repo, profile.sources.theme.path), "utf8"));
  const theme = themeSchema.parse({
    primary: c.primary.main,
    primaryContent: c.primary.contrastText,
    secondary: c.secondary.main,
    secondaryContent: c.secondary.contrastText,
    accent: c.primary.dark,
    accentContent: c.primary.contrastText,
    neutral: c.grey["800"],
    neutralContent: "#FFFFFF",
    base100: "#FFFFFF",
    base200: c.grey["100"],
    base300: c.grey["300"],
    baseContent: c.grey["800"],
    info: c.info.main,
    infoContent: c.info.contrastText,
    success: c.success.main,
    successContent: c.success.contrastText,
    warning: c.warning.main,
    warningContent: c.warning.contrastText,
    error: c.error.main,
    errorContent: c.error.contrastText,
    radius: "0.5rem",
    depth: 1,
  });
  write("prototype/theme.json", theme);
  themeNote = `${profile.sources.theme.path} から（primary ${theme.primary}）`;
}

// ---------------------------------------------------------------- pages
const isPage = (f: string) =>
  /\.(tsx|jsx|vue|svelte|dart)$/.test(f) && !/\.(test|spec|stories)\./.test(f);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : isPage(name) ? [p] : [];
  });
}

const pagesAbs = join(repo, profile.sources.pagesDir);
const pages = walk(pagesAbs)
  .map((p) => relative(repo, p))
  .sort();

// 同じディレクトリのページが同じ batch に入るよう、ディレクトリ順に並べてから切る
const batches: string[][] = [];
for (const p of pages) {
  const last = batches[batches.length - 1];
  if (!last || last.length >= BATCH) batches.push([p]);
  else last.push(p);
}

const common = (p: Profile) => `- システム: ${p.name}（${p.description ?? ""}）
- リポジトリ: ${repo}（コミット ${commit.slice(0, 9)}）
- UI: ${p.uiStack}`;

const navSources = [...(profile.sources.nav ?? []), ...(profile.sources.routes ?? [])];
write(
  "prompts/nav.md",
  `# ナビゲーションの起こし

${common(profile)}
- 読むファイル（リポジトリ相対）:
${navSources.map((s) => `  - ${s}`).join("\n")}
${profile.sources.screenInventory ? `- 画面一覧（参考）: ${profile.sources.screenInventory.path} の「${profile.sources.screenInventory.section ?? "全体"}」` : ""}

## 出力

\`${out}/artifacts/navigation.json\`
`,
);

batches.forEach((files, i) => {
  write(
    `prompts/screens-${i}.md`,
    `# 画面の起こし（batch ${i}）

${common(profile)}
- 部品の置き場所: ${(profile.sources.componentDirs ?? []).join(", ") || "（ページから import をたどる）"}
- ナビゲーション: \`${out}/artifacts/navigation.json\`（label を画面名に使う）

## 対象のページ（リポジトリ相対）

${files.map((f) => `- ${f}`).join("\n")}

## 出力

\`${out}/parts/wireframe-${i}.json\`
`,
  );
});

console.log(`baseline の前段を作った: ${out}`);
console.log(`  ソース: ${branch} @ ${commit.slice(0, 9)}${dirty ? "（未コミットの変更あり）" : ""}`);
console.log(`  データモデル: ${entityCount} エンティティ`);
console.log(`  テーマ: ${themeNote}`);
console.log(`  ページ: ${pages.length} 件 → ${batches.length} batch（${BATCH} 件ずつ）`);
console.log("");
console.log("次: mvp-baseline-nav を 1 体 → 終わったら mvp-baseline-screens を batch 数ぶん同時に起動");
console.log(`  batch 番号: 0〜${batches.length - 1}`);
