/**
 * 組み立てたモック（prototype/index.html）を、claude.ai の Artifact に出せる形にする。
 *
 *   pnpm exec tsx .claude/skills/mvp-refine/scripts/pack-artifact.ts <profileId> <イシュー> [--title 名前]
 *
 * Artifact の決まり: スタイルシートは Google Fonts 以外は埋め込む／スクリプトの CDN は版を固定する。
 * - daisyUI の CSS を埋め込む（.mvp/_cache に置いて使い回す）
 * - Tailwind・React・Babel の URL を固定の版にする
 * 出力: prototype/artifact.html（これを Artifact で publish する）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProfile, requestDir, usage } from "./_profile";

// 2 週間以上前に出た版にする（Artifact の決まり）。上げるときは npm の公開日を確かめる
const DAISYUI = "5.7.50";
const PIN: Record<string, string> = {
  "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4\"": "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.3\"",
  "https://unpkg.com/react@18/": "https://unpkg.com/react@18.3.1/",
  "https://unpkg.com/react-dom@18/": "https://unpkg.com/react-dom@18.3.1/",
  "https://unpkg.com/@babel/standalone/": "https://unpkg.com/@babel/standalone@7.26.9/",
};
const DAISY_LINK = '<link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />';

const args = process.argv.slice(2);
const ti = args.indexOf("--title");
const title = ti >= 0 ? args.splice(ti, 2)[1] : null;
const [profileId, issue] = args;
if (!profileId || !issue) {
  console.error(usage("pack-artifact.ts", "<profileId> <イシュー> [--title 名前]"));
  process.exit(2);
}
const profile = loadProfile(profileId);
const dir = requestDir(profile.id, issue);
const src = join(dir, "prototype/index.html");
if (!existsSync(src)) {
  console.error(`${src} が無い。先に assemble.ts を回す`);
  process.exit(1);
}

async function main(): Promise<void> {
  const cacheDir = join(".mvp", "_cache");
  const cssFile = join(cacheDir, `daisyui-${DAISYUI}.css`);
  if (!existsSync(cssFile)) {
    mkdirSync(cacheDir, { recursive: true });
    const res = await fetch(`https://cdn.jsdelivr.net/npm/daisyui@${DAISYUI}/daisyui.css`);
    if (!res.ok) {
      console.error(`daisyUI の CSS を取れない: HTTP ${res.status}`);
      process.exit(1);
    }
    writeFileSync(cssFile, await res.text());
  }

  let html = readFileSync(src, "utf8");
  if (!html.includes(DAISY_LINK)) {
    console.error("daisyUI の link が見つからない（骨格の CDN が変わった？ src/lib/prototype-ds/shell.ts を見る）");
    process.exit(1);
  }
  html = html.replace(DAISY_LINK, `<style>\n${readFileSync(cssFile, "utf8")}\n</style>`);
  for (const [from, to] of Object.entries(PIN)) {
    if (!html.includes(from)) {
      console.error(`CDN の URL が見つからない: ${from}`);
      process.exit(1);
    }
    html = html.split(from).join(to);
  }
  if (title) html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);

  const out = join(dir, "prototype/artifact.html");
  writeFileSync(out, html);
  console.log(`${out}（${Math.round(html.length / 1024)} KB）`);
  console.log("ブラウザで 1 度開いて確かめてから Artifact で publish する（同じ要望の 2 回目以降は同じ file_path で出すと URL が変わらない）");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
