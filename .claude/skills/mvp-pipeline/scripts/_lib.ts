/**
 * mvp-pipeline スクリプト群の共通部品。
 *
 * スキルのディレクトリを移したときに usage 文字列が一斉に嘘にならないよう、
 * 自分たちのパスはここ 1 箇所で持つ。
 */
import type { z } from "zod";

export const SCRIPTS = ".claude/skills/mvp-pipeline/scripts";
export const REFERENCES = ".claude/skills/mvp-pipeline/references";

/** `usage: tsx <scripts>/<name> <args>` を組み立てる。 */
export const usage = (name: string, args: string): string =>
  `usage: tsx ${SCRIPTS}/${name} ${args}`;

/**
 * zod の検証エラーを「どのパスがどう違うか」の行に整形する。
 * サブエージェントにそのまま渡して直させるための出力なので、体裁を揃える。
 */
export function formatZodIssues(
  issues: readonly z.core.$ZodIssue[],
  { withCode = true }: { withCode?: boolean } = {},
): string[] {
  return issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    return `  - ${path}: ${issue.message}${withCode ? ` [${issue.code}]` : ""}`;
  });
}
