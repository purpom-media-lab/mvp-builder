/**
 * baseline が今のソースに対して古くなっていないかを見る。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/baseline-status.ts <profileId>
 *
 * exit 0 = 最新 / 1 = 古い（作り直す）/ 2 = baseline が無い・壊れている
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { baselineDir, git, loadProfile, usage } from "./_profile";

const profileId = process.argv[2];
if (!profileId) {
  console.error(usage("baseline-status.ts", "<profileId>"));
  process.exit(2);
}
const profile = loadProfile(profileId);
const dir = baselineDir(profile.id);
const srcFile = join(dir, "sources.json");
const statusFile = join(dir, "status.json");

if (!existsSync(srcFile) || !existsSync(statusFile)) {
  console.log(`NONE     ${dir} に baseline が無い（baseline-collect → エージェント → baseline-merge）`);
  process.exit(2);
}
const src = JSON.parse(readFileSync(srcFile, "utf8")) as { commit: string; paths: string[]; collectedAt: string };
const status = JSON.parse(readFileSync(statusFile, "utf8")) as { ok: boolean; counts: Record<string, number> };
if (!status.ok) {
  console.log("BROKEN   前回の baseline-merge が失敗したまま。直して baseline-merge を再実行する");
  process.exit(2);
}

const head = git(profile.repoAbs, "rev-parse", "HEAD");
const changed = git(profile.repoAbs, "diff", "--name-only", src.commit, head, "--", ...src.paths)
  .split("\n")
  .filter(Boolean);

console.log(`baseline: ${src.commit.slice(0, 9)}（${src.collectedAt.slice(0, 10)}）／今: ${head.slice(0, 9)}`);
console.log(`画面 ${status.counts.screens}／ナビ ${status.counts.navItems}`);
if (!changed.length) {
  console.log("FRESH    ソースに変更なし");
  process.exit(0);
}
console.log(`STALE    参照しているソースが ${changed.length} ファイル変わった:`);
for (const f of changed.slice(0, 30)) console.log(`  ${f}`);
if (changed.length > 30) console.log(`  …ほか ${changed.length - 30} 件`);
console.log("→ 変わったページの batch だけ作り直すなら baseline-collect の後、該当 batch の mvp-baseline-screens を回す");
process.exit(1);
