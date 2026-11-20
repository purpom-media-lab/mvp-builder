/**
 * 段取り 2: 要望（イシュー）ごとの作業の置き場所を baseline から作る。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/request-init.ts <profileId> <イシュー>
 *
 * 作るもの（.mvp/<profile>/requests/<イシュー>/）:
 *   project.json              … 名前と要約（あとで直す）
 *   artifacts/navigation.json … baseline のナビの写し。ここに新しい画面を足し、変わらない画面は消す
 *   prototype/theme.json      … baseline のテーマ（既存システムの配色）
 *   spec/_common.md           … 全画面に効く指示の雛形
 *
 * 既にあるファイルは上書きしない（やり直すときは消してから）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baselineDir, loadProfile, requestDir, usage } from "./_profile";

const [profileId, issue] = process.argv.slice(2);
if (!profileId || !issue) {
  console.error(usage("request-init.ts", "<profileId> <イシュー>"));
  process.exit(2);
}
const profile = loadProfile(profileId);
const base = baselineDir(profile.id);
const dir = requestDir(profile.id, issue);
if (!existsSync(join(base, "status.json"))) {
  console.error(`baseline が無い: ${base}。先に段取り 1（baseline）を通す`);
  process.exit(1);
}
for (const d of ["artifacts", "prototype", "spec"]) mkdirSync(join(dir, d), { recursive: true });

const wrote: string[] = [];
const put = (rel: string, body: string) => {
  const f = join(dir, rel);
  if (existsSync(f)) return;
  writeFileSync(f, body);
  wrote.push(rel);
};

put(
  "project.json",
  `${JSON.stringify({ name: `${profile.name}（${issue} 案）`, summary: "（要望の要約を 2〜3 文で書く。誰が・何のために・どこを変えるか）" }, null, 2)}\n`,
);

// ナビは baseline の写し。アイコン名は骨格がそのまま文字で出してしまうので外す
const nav = JSON.parse(readFileSync(join(base, "artifacts/navigation.json"), "utf8")) as {
  items: { icon?: string | null }[];
};
put(
  "artifacts/navigation.json",
  `${JSON.stringify({ items: nav.items.map((n) => ({ ...n, icon: null })) }, null, 2)}\n`,
);

if (!existsSync(join(dir, "prototype/theme.json"))) {
  copyFileSync(join(base, "prototype/theme.json"), join(dir, "prototype/theme.json"));
  wrote.push("prototype/theme.json");
}

put(
  "spec/_common.md",
  `
# ここからは既存システムの改修案としての指示（上の「方針」より優先する）
- これは**稼働中の ${profile.name} に画面を足す・直す案**です。下に書いた項目・操作・文言だけを描く。書いていない列・ボタン・機能を足さない。
- 見た目は既存の画面に寄せる:（baseline の wireframe と Figma の master を見て、見出し・絞り込み・表・ページ送り・行メニュー・ダイアログの形を書く）
- **案の印**: 決まっていない表示は、その文字をオレンジ（\`text-warning\`）で書き、後ろに「（案）」を付ける。推測で決めない。
- モックデータは架空の名前にする。実在の利用者・職員・顧客の名前は使わない。
- 決まっていること:（イシュー・要件・課題管理表で決まったことを並べる）
`,
);

console.log(`要望の置き場所: ${dir}`);
console.log(wrote.length ? `作った: ${wrote.join(" / ")}` : "既にあるので何も作っていない");
console.log("\n次:");
console.log("  1. project.json の要約を書く");
console.log("  2. artifacts/navigation.json を直す（新しい画面を足す・変わらない画面は消す。一覧には「◯◯詳細」が自動で足される）");
console.log("  3. spec/_common.md と、画面ごとの spec/<画面名>.md を書く");
console.log(`  4. pnpm exec tsx .claude/skills/mvp-refine/scripts/request-proto.ts ${profile.id} ${issue}`);
