/**
 * mvp-refine の共通部品: プロファイル（既存システムごとの設定）の読み込みと、
 * baseline の置き場所・ソースのコミットの扱い。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const SKILL = ".claude/skills/mvp-refine";
export const SCRIPTS = `${SKILL}/scripts`;
export const PROFILES = `${SKILL}/profiles`;

export const usage = (name: string, args: string): string =>
  `usage: pnpm exec tsx ${SCRIPTS}/${name} ${args}`;

export type UiStack = "mui" | "daisyui" | "flutter-m3";

export interface Profile {
  id: string;
  name: string;
  description?: string;
  repo: string;
  uiStack: UiStack;
  sources: {
    screenInventory?: { path: string; section?: string };
    ooui?: string;
    nav?: string[];
    routes?: string[];
    pagesDir: string;
    pageGlob?: string;
    componentDirs?: string[];
    datamodel?: { format: "prisma"; path: string };
    theme?: { format: "mui-colors-json"; path: string };
    mock?: string;
  };
  figma?: { fileKey: string | null; fileName?: string; output: "branch" | "page" };
  requests?: Record<string, string>;
}

export const expandHome = (p: string): string =>
  p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

export function loadProfile(id: string): Profile & { repoAbs: string } {
  const file = join(PROFILES, `${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`プロファイルが無い: ${file}`);
  }
  const p = JSON.parse(readFileSync(file, "utf8")) as Profile;
  const repoAbs = resolve(expandHome(p.repo));
  if (!existsSync(repoAbs)) {
    throw new Error(`プロファイル ${id} のリポジトリが無い: ${repoAbs}`);
  }
  return { ...p, repoAbs };
}

/** baseline の置き場所（.mvp/<profile>/baseline）。 */
export const baselineDir = (id: string): string => join(".mvp", id, "baseline");

/** プロファイルが参照するソースのパス（リポジトリ相対）を全部並べる。 */
export function sourcePaths(p: Profile): string[] {
  const s = p.sources;
  return [
    s.screenInventory?.path,
    s.ooui,
    ...(s.nav ?? []),
    ...(s.routes ?? []),
    s.pagesDir,
    ...(s.componentDirs ?? []),
    s.datamodel?.path,
    s.theme?.path,
    s.mock,
  ].filter((x): x is string => !!x);
}

export const git = (repo: string, ...args: string[]): string =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
