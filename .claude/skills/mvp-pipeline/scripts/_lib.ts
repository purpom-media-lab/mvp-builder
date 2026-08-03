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

/**
 * 工程をまたぐ整合性チェック。
 *
 * 個々の成果物は zod を通っていても、**工程間の参照**は検証されない。
 * いま見ているのは 1 件だけ: ユースケースの `actorName` がアクター一覧に存在するか。
 *
 * これが崩れると本体 DB では `use_cases.actorId` が null になり（同名アクターが
 * 見つからないため）、画面遷移図からアクターが消える。書き戻して初めて気づく類なので、
 * パイプラインの検証段階で出す。
 */
export function crossCheckArtifacts(
  readArtifact: (step: string) => unknown,
): string[] {
  const warnings: string[] = [];

  const actors = (readArtifact("actors") as { actors?: { name?: string }[] } | null)
    ?.actors;
  const useCases = (
    readArtifact("usecases") as { useCases?: { actorName?: string }[] } | null
  )?.useCases;

  if (actors?.length && useCases?.length) {
    const known = new Set(actors.map((a) => a.name));
    const missing = new Map<string, number>();
    for (const u of useCases) {
      const n = u.actorName;
      if (n && !known.has(n)) missing.set(n, (missing.get(n) ?? 0) + 1);
    }
    if (missing.size) {
      warnings.push(
        `usecases の actorName が actors に無い: ${[...missing]
          .map(([n, c]) => `「${n}」(${c}件)`)
          .join(" / ")}`,
        `  → 本体に保存すると該当ユースケースの actorId が null になる（画面遷移図からアクターが消える）。`,
        `  → actors 側の名前（${[...known].join(" / ")}）に合わせるか、usecases を作り直すこと。`,
      );
    }
  }

  return warnings;
}
