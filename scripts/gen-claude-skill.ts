/**
 * Claude Code 版 MVP パイプラインの資産を `src/lib/ai/step-specs.ts` から生成する。
 *
 * 生成物:
 *   .claude/agents/mvp-<step>.md                          … 13工程のサブエージェント定義
 *   .claude/skills/mvp-pipeline/references/schemas/*.json … 各工程の出力 JSON Schema
 *   .claude/skills/mvp-pipeline/references/waves.md       … 依存ウェーブ・モデル割当の一覧
 *
 * 実行:
 *   pnpm gen:skill
 *
 * プロンプトの単一ソースは step-specs.ts。生成物を直接編集しても次回生成で失われる。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  FAST_STEPS,
  roleHeader,
  STEP_SPECS,
  WAVES,
} from "../src/lib/ai/step-specs";
import type { StepKey } from "../src/lib/projects";

const AGENTS_DIR = ".claude/agents";
const SKILL_DIR = ".claude/skills/mvp-pipeline";
const REF_DIR = join(SKILL_DIR, "references");
const SCHEMA_DIR = join(REF_DIR, "schemas");

const BANNER =
  "<!-- 自動生成: scripts/gen-claude-skill.ts が src/lib/ai/step-specs.ts から生成。手で編集しない。 -->";

/**
 * Claude Code 版は全工程を標準モデルで実行する。
 *
 * 本体は actors/usecases/journey を FAST_MODEL（haiku）で回してレイテンシを下げているが、
 * 本体は generateObject でスキーマを強制した上での1回生成なのに対し、Claude Code では
 * サブエージェントが自律的に「どこまで書くか」を決める。実測（社労士顧客管理システム）で
 * 次の差が出たため、CC 版では fast 段を使わない:
 *
 *   usecases: haiku 4件 / sonnet 12件（本体 8件）
 *   actors  : haiku 3件（system アクターを落とす） / sonnet 5件（本体 5件）
 *
 * actors/usecases はパイプラインの最上流なので、ここが薄いと ooui→navigation→wireframe
 * まで連鎖して薄くなる。並列ウェーブで回す CC 版はレイテンシ面の余裕もあるため品質を取る。
 * （本体側の FAST_STEPS の扱いは変えない。step-specs.ts の `fast` はそのまま残す。）
 */
const AGENT_MODEL = "sonnet";

/** その工程が参照できる先行工程（自分より前のウェーブすべて）。本体の文脈積み上げと同じ。 */
function upstreamOf(step: StepKey): StepKey[] {
  const waveIndex = WAVES.findIndex((w) => w.includes(step));
  return WAVES.slice(0, waveIndex).flat();
}

function agentMarkdown(step: StepKey): string {
  const spec = STEP_SPECS[step];
  const upstream = upstreamOf(step);
  const inputs = [
    "- `<projectDir>/project.json` — プロジェクト名・概要・ジョブ分析(JTBD)・入力資料の要約",
    ...upstream.map(
      (u) => `- \`<projectDir>/artifacts/${u}.json\` — ${STEP_SPECS[u].label}`,
    ),
  ].join("\n");

  return `---
name: mvp-${step}
description: MVPパイプラインの「${spec.label}」工程（担当ロール: ${spec.role}）。<projectDir> を渡すと artifacts/${step}.json を書き出す。
model: ${AGENT_MODEL}
tools: Read, Write, Glob, Grep
---

${BANNER}

${roleHeader(step)}

# 工程の指示

${spec.system}

# 手順

1. 呼び出し時に渡された \`<projectDir>\`（例: \`.mvp/my-product\`）を確認する。
2. 次の入力をすべて Read する。存在しないファイルは飛ばしてよい。
${inputs}
3. \`.claude/skills/mvp-pipeline/references/schemas/${step}.json\`（JSON Schema）を Read し、
   出力の形を厳密に把握する。
4. 上の「工程の指示」に従って内容を作り、**JSON Schema に厳密に準拠した JSON** を
   \`<projectDir>/artifacts/${step}.json\` に Write する。

# 厳守事項

- 出力ファイルは JSON のみ。コメント・コードフェンス・前後の説明文を書かない。
- スキーマにないキーを足さない。必須キーを省略しない。\`nullable\` でないフィールドを null にしない。
- 値はスキーマの \`description\` の指示（日本語で書く・単位・粒度など）に従う。
- ジョブ分析（JTBD）の内容が入力資料と矛盾する場合は、**必ずジョブ分析を優先**する。
- 応答本文には「${spec.label}を <projectDir>/artifacts/${step}.json に書き出した。<要点1行>」だけを返す。
  生成した JSON 本体を応答に含めない（呼び出し元のコンテキストを消費しないため）。
`;
}

function wavesMarkdown(): string {
  const rows = WAVES.flatMap((wave, i) =>
    wave.map((step) => {
      const s = STEP_SPECS[step];
      const fastNote = FAST_STEPS.has(step) ? "haiku" : "同左";
      return `| ${i + 1} | \`${step}\` | ${s.label} | ${s.role} | ${AGENT_MODEL} | ${fastNote} |`;
    }),
  ).join("\n");

  const waveList = WAVES.map(
    (wave, i) =>
      `${i + 1}. ${wave.map((s) => `\`${s}\``).join(" / ")}${wave.length > 1 ? "  ← 並列" : ""}`,
  ).join("\n");

  return `${BANNER}

# 実行ウェーブ（依存順）

同一ウェーブ内の工程は**依存関係がないので同時に起動する**（1メッセージで複数の Task を発行する）。
後段のウェーブは、前段までの \`artifacts/*.json\` をすべて参照できる。

${waveList}

# 工程一覧

| ウェーブ | キー | 工程 | 担当ロール | モデル | 本体のモデル |
| --- | --- | --- | --- | --- | --- |
${rows}

Claude Code 版は全工程を \`${AGENT_MODEL}\` で回す。本体が \`haiku\` を使う工程（actors/usecases/journey）も
ここでは落とさない — 上流工程が薄いと下流のウェーブすべてに連鎖するため（根拠は
\`scripts/gen-claude-skill.ts\` の \`AGENT_MODEL\` のコメント）。

# ウェーブ順序の根拠

- \`journey\` は体験レンズ。抽出した painpoint / opportunity を \`scope\` の優先度判断に流すため \`scope\` の前。
- \`market\` は市場規模(TAM/SAM/SOM)・競合・参入余地。\`scope\` の優先度判断と差別化仮説の材料になるため \`ooui\`/\`scope\` の前。
- \`navigation\` は OOUI オブジェクト/関連の構造推論が要るため、本体でも高速モデルの対象外。
`;
}

/** 生成物ディレクトリを作り直す（消し忘れの残骸を残さない）。 */
function resetDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// --- 生成 ---------------------------------------------------------------

mkdirSync(AGENTS_DIR, { recursive: true });
resetDir(SCHEMA_DIR);
mkdirSync(REF_DIR, { recursive: true });

// 既存の mvp-*.md は一旦削除（工程名の変更で孤児が残るのを防ぐ）。
for (const f of readdirSync(AGENTS_DIR)) {
  if (/^mvp-.*\.md$/.test(f)) rmSync(join(AGENTS_DIR, f));
}

const steps = WAVES.flat();
for (const step of steps) {
  writeFileSync(join(AGENTS_DIR, `mvp-${step}.md`), agentMarkdown(step));
  const jsonSchema = z.toJSONSchema(STEP_SPECS[step].schema, {
    io: "output",
    unrepresentable: "any",
  });
  writeFileSync(
    join(SCHEMA_DIR, `${step}.json`),
    `${JSON.stringify(jsonSchema, null, 2)}\n`,
  );
}
writeFileSync(join(REF_DIR, "waves.md"), wavesMarkdown());

console.log(
  `generated: ${steps.length} agents (${AGENTS_DIR}/mvp-*.md), ${steps.length} schemas (${SCHEMA_DIR}), ${REF_DIR}/waves.md`,
);
