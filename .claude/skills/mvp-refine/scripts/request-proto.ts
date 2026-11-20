/**
 * 段取り 3: 要望の画面のプロンプトを作る（mvp-pipeline の plan-screens に、画面ごとの仕様を足す）。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/request-proto.ts <profileId> <イシュー> [画面名 ...]
 *
 * 1. plan-screens.ts を回す（画面の導出・プロンプトの本文は本体と同じコード）
 * 2. 作り直す画面のプロンプトの末尾に spec/_common.md と spec/<画面名>.md を足す
 *    spec の無い画面は止める（仕様なしで描かせると、既存システムに無い機能を発明する）
 *
 * このあと mvp-screen を画面数ぶん 1 メッセージで起動 → mvp-pipeline の assemble.ts → pack-artifact.ts。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, requestDir, usage } from "./_profile";

const [profileId, issue, ...only] = process.argv.slice(2);
if (!profileId || !issue) {
  console.error(usage("request-proto.ts", "<profileId> <イシュー> [画面名 ...]"));
  process.exit(2);
}
const profile = loadProfile(profileId);
const dir = requestDir(profile.id, issue);
if (!existsSync(join(dir, "artifacts/navigation.json"))) {
  console.error(`${dir} が無い。先に request-init.ts を回す`);
  process.exit(1);
}

const out = execFileSync(
  "pnpm",
  ["exec", "tsx", ".claude/skills/mvp-pipeline/scripts/plan-screens.ts", dir, ...only],
  { encoding: "utf8" },
);
const plan = JSON.parse(readFileSync(join(dir, "prototype/plan.json"), "utf8")) as {
  screens: { index: number; label: string; regenerate: boolean }[];
};

const common = existsSync(join(dir, "spec/_common.md")) ? readFileSync(join(dir, "spec/_common.md"), "utf8") : "";
const missing: string[] = [];
for (const s of plan.screens.filter((x) => x.regenerate)) {
  const f = join(dir, "spec", `${s.label}.md`);
  if (!existsSync(f)) {
    missing.push(s.label);
    continue;
  }
  appendFileSync(join(dir, "prototype/prompts", `${s.index}.md`), `${common}\n${readFileSync(f, "utf8")}`);
}

console.log(out.split("\n").filter((l) => /^(画面|  (生成|再利用))/.test(l)).join("\n"));
if (missing.length) {
  console.log(`\nINVALID  仕様（spec/<画面名>.md）の無い画面: ${missing.join(" / ")}`);
  console.log("  → 書いてから再実行する（プロンプトは作り直される）");
  process.exit(1);
}
const todo = plan.screens.filter((x) => x.regenerate).map((x) => x.index);
console.log(`\n次: mvp-screen を ${todo.length} 体、1 メッセージで起動する（projectDir=${dir} / 画面番号=${todo.join(", ")}）`);
console.log(`揃ったら: pnpm exec tsx .claude/skills/mvp-pipeline/scripts/assemble.ts ${dir}`);
console.log(`そのあと: pnpm exec tsx .claude/skills/mvp-refine/scripts/pack-artifact.ts ${profile.id} ${issue}`);
