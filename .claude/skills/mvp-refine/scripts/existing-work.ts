/**
 * 段取り 2 の最初: その要望に、もう検討が進んでいないかを機械で探す。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/existing-work.ts <profileId> <イシュー> [言葉 ...]
 *
 * - 社内メモ（profile.existingWork.notesDirs）からイシューのキーと言葉を探す
 * - Figma の画面インデックス（profile.existingWork.figmaIndex）の draft の行から言葉を探す
 *
 * Figma のページ名（インデックスに載っていない新しい draft のページ）と、イシューのコメントは
 * ここでは見られない。SKILL.md の手順どおり Figma MCP と Linear MCP で確かめる。
 *
 * exit 0 = 何も見つからない / 3 = 見つかった（作り始める前に中身を読む）
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, usage } from "./_profile";

const [profileId, issue, ...words] = process.argv.slice(2);
if (!profileId || !issue) {
  console.error(usage("existing-work.ts", "<profileId> <イシュー> [言葉 ...]"));
  process.exit(2);
}
const profile = loadProfile(profileId);
const ew = profile.existingWork ?? {};
const terms = [issue, ...words];
let hits = 0;

// ---------------------------------------------------------------- 社内メモ
for (const dir of ew.notesDirs ?? []) {
  const abs = join(profile.repoAbs, dir);
  if (!existsSync(abs)) {
    console.log(`SKIP     社内メモ ${dir} が無い（internal を clone していない？）`);
    continue;
  }
  // イシューのキーはファイル名と本文の両方。言葉は本文だけ（ありふれた言葉で溢れないよう件数を絞る）
  const run = (args: string[]): string[] => {
    try {
      return execFileSync("rg", args, { encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      return []; // rg は 1 件も無いと exit 1
    }
  };
  const byKey = new Set([
    ...run(["-l", "-i", "--glob", "*.md", issue, abs]),
    ...run(["--files", abs]).filter((f) => f.toLowerCase().includes(issue.toLowerCase())),
  ]);
  // 手元の checkout が古いと、別のセッションが push したメモを見落とす（BS-8296 で実際に起きた）。
  // メモの置き場が git リポジトリなら、fetch して origin の既定ブランチも探す（読むだけ）。
  try {
    const top = execFileSync("git", ["-C", abs, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const rel = abs.slice(top.length + 1) || ".";
    execFileSync("git", ["-C", top, "fetch", "-q", "origin"], { stdio: "ignore", timeout: 30_000 });
    const behind = execFileSync("git", ["-C", top, "rev-list", "--count", "HEAD..origin/HEAD"], { encoding: "utf8" }).trim();
    if (behind !== "0") console.log(`WARN     ${top.replace(`${profile.repoAbs}/`, "")} は origin より ${behind} コミット古い（origin/HEAD も探す）`);
    const remote = execFileSync("git", ["-C", top, "ls-tree", "-r", "--name-only", "origin/HEAD", "--", rel], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.toLowerCase().includes(issue.toLowerCase()));
    let grep: string[] = [];
    try {
      grep = execFileSync("git", ["-C", top, "grep", "-l", "-i", issue, "origin/HEAD", "--", rel], { encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map((l) => l.replace(/^origin\/HEAD:/, ""));
    } catch {
      /* 1 件も無い */
    }
    for (const f of [...remote, ...grep]) byKey.add(join(top, f));
  } catch {
    /* git でない・fetch できない: 手元だけ */
  }
  const byWords = words.length
    ? run(["-l", "--glob", "*.md", ...words.flatMap((w) => ["-e", w]), abs]).filter((f) => !byKey.has(f))
    : [];
  if (byKey.size) {
    hits += byKey.size;
    console.log(`FOUND    社内メモにイシュー ${issue} の記述（${byKey.size} 件）:`);
    for (const f of [...byKey].slice(0, 15)) console.log(`  ${f.replace(`${profile.repoAbs}/`, "")}`);
  }
  if (byWords.length) {
    console.log(`MAYBE    社内メモに言葉（${words.join("・")}）を含むもの ${byWords.length} 件（新しい順に 10 件）:`);
    for (const f of byWords.sort().reverse().slice(0, 10)) console.log(`  ${f.replace(`${profile.repoAbs}/`, "")}`);
  }
}

// ---------------------------------------------------------------- Figma の draft（インデックス）
if (ew.figmaIndex) {
  const abs = join(profile.repoAbs, ew.figmaIndex);
  if (!existsSync(abs)) {
    console.log(`SKIP     Figma の画面インデックス ${ew.figmaIndex} が無い`);
  } else {
    const rows = readFileSync(abs, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
    const header = rows.shift()?.split("\t") ?? [];
    const kindAt = header.indexOf("kind");
    const drafts = rows.filter((r) => r.split("\t")[kindAt] === "draft");
    const found = drafts.filter((r) => terms.some((t) => r.includes(t)));
    if (found.length) {
      hits += found.length;
      console.log(`FOUND    Figma の draft に該当しそうな画面 ${found.length} 件:`);
      for (const r of found.slice(0, 15)) {
        const c = r.split("\t");
        console.log(`  [${c[header.indexOf("page")]}] ${c[header.indexOf("name")]}  ${c[header.indexOf("url")]}`);
      }
    }
  }
}

console.log("");
console.log("ここでは見られないもの（MCP で確かめる）:");
console.log(`  - Figma のページ名: get_metadata（nodeId なし）でページ一覧を取り、${issue}・言葉を含むページを探す`);
console.log(`  - イシューのコメント・関連イシュー: Linear の get_issue（includeRelations）と list_comments`);
if (hits) {
  console.log(`\n${hits} 件見つかった。作り始める前に中身を読み、作り直すか・それに合わせるかを決める`);
  process.exit(3);
}
console.log("\n機械で探せる範囲では見つからなかった");
