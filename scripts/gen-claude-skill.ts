/**
 * Claude Code 版 MVP パイプラインの資産を本体のソースから生成する。
 *
 * 生成物（生成元）:
 *   .claude/agents/mvp-<step>.md                          … 13工程のサブエージェント（step-specs.ts）
 *   .claude/agents/mvp-screen.md                          … プロトタイプ1画面（prototype-ds/prompt.ts）
 *   .claude/agents/mvp-theme.md                           … daisyUI テーマ（prototype-ds/theme-spec.ts）
 *   .claude/agents/mvp-orchestrate.md                     … 要望→再実行工程の計画（ai/orchestrate-spec.ts）
 *   .claude/skills/mvp-pipeline/references/schemas/*.json … 各工程 + theme の出力 JSON Schema
 *   .claude/skills/mvp-pipeline/references/waves.md       … 依存ウェーブ・モデル割当の一覧
 *   .claude/skills/mvp-pipeline/references/daisyui.md     … daisyUI 5 リファレンス（画面生成が Read する）
 *   .claude/workflows/mvp-pipeline.js                     … ウェーブ並列を決定的に回す版（step-specs.ts）
 *
 * 実行:
 *   pnpm gen:skill
 *
 * プロンプトの単一ソースは本体側。生成物を直接編集しても次回生成で失われる。
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  FAST_STEPS,
  roleHeader,
  STEP_ORDER,
  STEP_SPECS,
  WAVES,
} from "../src/lib/ai/step-specs";
import { ORCHESTRATE_SYSTEM } from "../src/lib/ai/orchestrate-spec";
import { orchestratePlanSchema } from "../src/lib/ai/schemas";
import { DAISYUI_REFERENCE } from "../src/lib/prototype-ds/daisyui-reference";
import { SCREEN_SYSTEM } from "../src/lib/prototype-ds/prompt";
import { THEME_SYSTEM, themeSchema } from "../src/lib/prototype-ds/theme-spec";
import type { StepKey } from "../src/lib/projects";

const AGENTS_DIR = ".claude/agents";
const WORKFLOWS_DIR = ".claude/workflows";
const SCRIPTS_DIR = ".claude/skills/mvp-pipeline/scripts";
const SKILL_DIR = ".claude/skills/mvp-pipeline";
const REF_DIR = join(SKILL_DIR, "references");
const SCHEMA_DIR = join(REF_DIR, "schemas");

const banner = (source: string) =>
  `<!-- 自動生成: scripts/gen-claude-skill.ts が ${source} から生成。手で編集しない。 -->`;
const BANNER = banner("src/lib/ai/step-specs.ts");

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

/** JSON を書き出す工程に共通の厳守事項。 */
const JSON_OUTPUT_RULES = [
  "- 出力ファイルは JSON のみ。コメント・コードフェンス・前後の説明文を書かない。",
  "- スキーマにないキーを足さない。必須キーを省略しない。",
];

/** 応答本文を1行に抑えるルール（親のコンテキストを汚さないため）。 */
const terseReply = (what: string, body: string) =>
  `- 応答本文には「${what}」だけを返す。\n  ${body}を応答に含めない（呼び出し元のコンテキストを消費しないため）。`;

/** エージェント定義 1 枚を組み立てる。frontmatter の形をここ 1 箇所で決める。 */
function agentDoc(a: {
  name: string;
  description: string;
  tools: string;
  /** 生成元ファイル（自動生成バナーに出す） */
  source: string;
  /** ロール宣言 + system プロンプト */
  system: string;
  steps: string;
  rules: string[];
}): string {
  return `---
name: ${a.name}
description: ${a.description}
model: ${AGENT_MODEL}
tools: ${a.tools}
---

${banner(a.source)}

${a.system}

# 手順

${a.steps}

# 厳守事項

${a.rules.join("\n")}
`;
}

function agentMarkdown(step: StepKey): string {
  const spec = STEP_SPECS[step];
  const inputs = [
    "- `<projectDir>/project.json` — プロジェクト名・概要・ジョブ分析(JTBD)・入力資料の要約",
    ...upstreamOf(step).map(
      (u) => `- \`<projectDir>/artifacts/${u}.json\` — ${STEP_SPECS[u].label}`,
    ),
  ].join("\n");

  return agentDoc({
    name: `mvp-${step}`,
    description: `MVPパイプラインの「${spec.label}」工程（担当ロール: ${spec.role}）。<projectDir> を渡すと artifacts/${step}.json を書き出す。`,
    tools: "Read, Write, Glob, Grep",
    source: "src/lib/ai/step-specs.ts",
    system: `${roleHeader(step)}\n\n# 工程の指示\n\n${spec.system}`,
    steps: `1. 呼び出し時に渡された \`<projectDir>\`（例: \`.mvp/my-product\`）を確認する。
2. 次の入力をすべて Read する。存在しないファイルは飛ばしてよい。
${inputs}
3. \`${SCHEMA_DIR}/${step}.json\`（JSON Schema）を Read し、出力の形を厳密に把握する。
4. 上の「工程の指示」に従って内容を作り、**JSON Schema に厳密に準拠した JSON** を
   \`<projectDir>/artifacts/${step}.json\` に Write する。`,
    rules: [
      ...JSON_OUTPUT_RULES,
      "- `nullable` でないフィールドを null にしない。",
      "- 値はスキーマの `description` の指示（日本語で書く・単位・粒度など）に従う。",
      "- ジョブ分析（JTBD）の内容が入力資料と矛盾する場合は、**必ずジョブ分析を優先**する。",
      terseReply(
        `${spec.label}を <projectDir>/artifacts/${step}.json に書き出した。<要点1行>`,
        "生成した JSON 本体",
      ),
    ],
  });
}

/**
 * プロトタイプの1画面を書くサブエージェント。
 *
 * 画面の書き方そのものは `SCREEN_SYSTEM`（本体が system として渡しているものと同一）が
 * すべて持つ。ここで足すのは **Claude Code 版に固有の差分だけ** ——
 * 文脈をメッセージではなくファイルから読み、結果をファイルに書く、という受け渡しの契約。
 */
function screenAgentMarkdown(): string {
  return agentDoc({
    name: "mvp-screen",
    description:
      "MVPプロトタイプの1画面を React 関数コンポーネントとして実装する（担当ロール: フロントエンドエンジニア）。<projectDir> と画面番号を渡すと prototype/screens/<番号>.jsx を書き出す。",
    tools: "Read, Write",
    source: "src/lib/prototype-ds/prompt.ts",
    system: SCREEN_SYSTEM,
    steps: `1. 呼び出し時に渡された \`<projectDir>\`（例: \`.mvp/my-product\`）と**画面番号**を確認する。
2. \`${REF_DIR}/daisyui.md\` を Read する。
   使ってよいクラス名・構文はここが唯一の正。**推測で書かない**。
3. \`<projectDir>/prototype/prompts/<番号>.md\` を Read する。
   アプリの文脈・対象画面・遷移の指示が書いてある。
4. 上の「出力形式」に従って関数コンポーネントを1つ書き、
   \`<projectDir>/prototype/screens/<番号>.jsx\` に Write する。`,
    rules: [
      "- 上の規約はファイルの中身に対する指示。ファイルには**関数1つだけ**を書く。",
      "- 括弧の対応が崩れた出力は組み立て側で破棄されプレースホルダになる。書き切ること。",
      terseReply(
        "`<画面名>` を prototype/screens/<番号>.jsx に書き出した。<要点1行>",
        "コンポーネントのソース",
      ),
    ],
  });
}

/** ブランドから daisyUI テーマを設計するサブエージェント（本体の generateDaisyTheme 相当）。 */
function themeAgentMarkdown(): string {
  return agentDoc({
    name: "mvp-theme",
    description:
      "MVPプロトタイプの daisyUI 5 テーマ（全セマンティック変数）を設計する（担当ロール: UIカラーシステム設計）。<projectDir> を渡すと prototype/theme.json を書き出す。",
    tools: "Read, Write",
    source: "src/lib/prototype-ds/theme-spec.ts",
    system: THEME_SYSTEM,
    steps: `1. 呼び出し時に渡された \`<projectDir>\` を確認する。
2. \`<projectDir>/prototype/prompts/theme.md\` を Read する（ブランド名・トーン・基調色）。
3. \`${SCHEMA_DIR}/theme.json\`（JSON Schema）を Read する。
4. スキーマに厳密に準拠した JSON を \`<projectDir>/prototype/theme.json\` に Write する。`,
    rules: [
      ...JSON_OUTPUT_RULES,
      "- 色はすべて `#rrggbb` の6桁 HEX（3桁短縮・`rgb()`・色名は不可）。",
      terseReply(
        "テーマを prototype/theme.json に書き出した。<基調色と方向性を1行>",
        "テーマの JSON 本体",
      ),
    ],
  });
}

/**
 * 要望から「どの工程を作り直すか」を決めるサブエージェント。
 *
 * 本体の planOrchestration() と同じ判断基準（ORCHESTRATE_SYSTEM）を持つ。
 * 違いは出力先だけ: 本体は generateObject の戻り値、CC 版はファイル。
 */
function orchestrateAgentMarkdown(): string {
  return agentDoc({
    name: "mvp-orchestrate",
    description:
      "ユーザーの要望から、再実行すべき分析工程とプロトタイプ再生成の要否を決める（担当ロール: オーケストレーター）。<projectDir> と要望を渡すと update-plan.json を書き出す。",
    tools: "Read, Write",
    source: "src/lib/ai/orchestrate-spec.ts",
    system: ORCHESTRATE_SYSTEM,
    steps: `1. 呼び出し時に渡された \`<projectDir>\` と**ユーザーの要望**を確認する。
2. 現在の分析状態を把握するため、\`<projectDir>/project.json\` と
   \`<projectDir>/artifacts/*.json\` を Read する（存在するものだけでよい）。
3. \`${SCHEMA_DIR}/orchestrate.json\`（JSON Schema）を Read する。
4. スキーマに厳密に準拠した JSON を \`<projectDir>/update-plan.json\` に Write する。`,
    rules: [
      ...JSON_OUTPUT_RULES,
      "- **要望に関係する最小限の工程だけ**選ぶ。迷ったら少ないほうに倒す（再実行は下流に連鎖して時間がかかる）。",
      "- 要望がどの工程にも当たらない場合は `steps` を空配列にし、`reply` でその旨を述べる。",
      "- `ooui` を選ぶと `navigation` は自動的に後続へ足されるので、`steps` に明記しなくてよい。",
      terseReply(
        "計画を <projectDir>/update-plan.json に書き出した。<選んだ工程と理由を1行>",
        "計画の JSON 本体",
      ),
    ],
  });
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

/**
 * ウェーブ並列を決定的に回す Workflow 版。
 *
 * Workflow スクリプトは**プレーンな JS で import できない**ため、ウェーブ定義と
 * 工程名をここで埋め込む。手で写すと step-specs.ts からずれるので生成する。
 *
 * スキル版（SKILL.md + サブエージェント）との違いは、並列の粒度・検証・リトライが
 * スクリプトで固定される点。オーケストレータの判断に委ねないぶん取りこぼしが無い。
 * 起動にユーザーの明示的な opt-in が要るので、日常の入口はスキル版のまま。
 */
function workflowScript(): string {
  const meta = {
    name: "mvp-pipeline",
    description:
      "13工程をウェーブ並列で回し、ウェーブごとの検証と作り直しまで決定的に行う。プロトタイプ生成まで含む。",
    whenToUse:
      "分析からプロトタイプまでを一息に通したいとき。日常の部分的な操作は /mvp-run /mvp-step /mvp-proto を使う。",
    phases: [
      ...WAVES.map((wave, i) => ({
        title: `Wave ${i + 1}`,
        detail: wave.map((s) => STEP_SPECS[s].label).join(" / "),
      })),
      { title: "検証", detail: "スキーマ検証と、失敗した工程の作り直し" },
      { title: "プロトタイプ", detail: "画面の確定 → 並列生成 → 組み立て" },
    ],
  };

  const body = [
  "",
  "const WAVES = __WAVES__",
  "const LABELS = __LABELS__",
  "const SCRIPTS = __SCRIPTS__",
  "",
  "// projectDir は args で受け取る。例: { projectDir: \".mvp/lead-crm\" }",
  "const projectDir = typeof args === \"string\" ? args : args?.projectDir",
  "if (!projectDir) {",
  "  throw new Error(",
  "    'projectDir を渡すこと。例: args = { projectDir: \".mvp/lead-crm\" }。' +",
  "      \"project.json（name/summary/analysisResult）は先に用意しておくこと。\",",
  "  )",
  "}",
  "",
  "const VALIDATION = {",
  "  type: \"object\",",
  "  properties: {",
  "    ok: { type: \"boolean\", description: \"全工程が OK なら true\" },",
  "    failures: {",
  "      type: \"array\",",
  "      items: {",
  "        type: \"object\",",
  "        properties: {",
  "          step: { type: \"string\", description: \"工程キー\" },",
  "          detail: { type: \"string\", description: \"validate.ts が出したエラー明細\" },",
  "        },",
  "        required: [\"step\", \"detail\"],",
  "      },",
  "    },",
  "  },",
  "  required: [\"ok\", \"failures\"],",
  "}",
  "",
  "/** validate.ts を実行し、結果を構造化して返す。 */",
  "function validate(steps, phaseName) {",
  "  const cmd = \"pnpm exec tsx \" + SCRIPTS + \"/validate.ts \" + projectDir + \" \" + steps.join(\" \")",
  "  return agent(",
  "    \"次のコマンドを実行し、出力をそのまま構造化して返してください。\\n\\n  \" + cmd + \"\\n\\n\" +",
  "      \"INVALID / MISSING の行があれば ok=false とし、工程ごとのエラー明細を failures に入れる。\" +",
  "      \"「⚠ 工程間の整合性」は警告であって失敗ではないので failures に入れない。\",",
  "    { label: \"validate:\" + phaseName, phase: \"検証\", schema: VALIDATION, effort: \"low\" },",
  "  )",
  "}",
  "",
  "/** 1工程を実行する。detail があれば「直し」として渡す。 */",
  "function runStep(step, detail) {",
  "  const base =",
  "    \"projectDir = \" + projectDir +",
  "    \"\\nこの工程を実行して artifacts/\" + step + \".json を書き出してください。\"",
  "  const prompt = detail",
  "    ? base + \"\\n\\n前回の出力はスキーマ検証を通りませんでした。次の指摘を直して書き直してください。\\n\" + detail",
  "    : base",
  "  return agent(prompt, { agentType: \"mvp-\" + step, label: step })",
  "}",
  "",
  "// --- 13工程（ウェーブ並列 → 検証 → 1回だけ作り直し） ----------------------",
  "",
  "for (let i = 0; i < WAVES.length; i++) {",
  "  const wave = WAVES[i]",
  "  const name = \"Wave \" + (i + 1)",
  "  phase(name)",
  "  await parallel(wave.map((step) => () => runStep(step)))",
  "",
  "  const result = await validate(wave, name)",
  "  if (result && !result.ok && result.failures && result.failures.length) {",
  "    const names = result.failures.map((f) => LABELS[f.step] || f.step).join(\" / \")",
  "    log(name + \": \" + names + \" がスキーマ検証を通らなかった。作り直す。\")",
  "    phase(name)",
  "    await parallel(result.failures.map((f) => () => runStep(f.step, f.detail)))",
  "    const retry = await validate(wave, name + \"-retry\")",
  "    if (retry && !retry.ok) {",
  "      // 2回目も通らなければ止める（手で JSON を書き換えない）。",
  "      return {",
  "        stoppedAt: name,",
  "        failures: retry.failures,",
  "        hint: \"該当工程の指示（step-specs.ts）かスキーマを見直すこと。\",",
  "      }",
  "    }",
  "  }",
  "}",
  "",
  "// --- プロトタイプ ---------------------------------------------------------",
  "",
  "phase(\"プロトタイプ\")",
  "",
  "const PLAN = {",
  "  type: \"object\",",
  "  properties: {",
  "    indexes: {",
  "      type: \"array\",",
  "      items: { type: \"number\" },",
  "      description: \"「生成」と表示された画面番号\",",
  "    },",
  "    needsTheme: { type: \"boolean\", description: \"テーマを生成すると出ていたか\" },",
  "  },",
  "  required: [\"indexes\", \"needsTheme\"],",
  "}",
  "",
  "const plan = await agent(",
  "  \"次を実行し、出力を構造化して返してください。\\n\\n  pnpm exec tsx \" +",
  "    SCRIPTS + \"/plan-screens.ts \" + projectDir + \"\\n\\n\" +",
  "    \"「生成」と表示された画面番号を indexes に入れる（「再利用」は入れない）。\",",
  "  { label: \"plan-screens\", phase: \"プロトタイプ\", schema: PLAN, effort: \"low\" },",
  ")",
  "",
  "if (plan && plan.indexes && plan.indexes.length) {",
  "  const jobs = plan.indexes.map(",
  "    (i) => () =>",
  "      agent(\"projectDir = \" + projectDir + \"\\n画面番号 = \" + i, {",
  "        agentType: \"mvp-screen\",",
  "        label: \"screen:\" + i,",
  "        phase: \"プロトタイプ\",",
  "      }),",
  "  )",
  "  if (plan.needsTheme) {",
  "    jobs.push(() =>",
  "      agent(\"projectDir = \" + projectDir, {",
  "        agentType: \"mvp-theme\",",
  "        label: \"theme\",",
  "        phase: \"プロトタイプ\",",
  "      }),",
  "    )",
  "  }",
  "  await parallel(jobs)",
  "}",
  "",
  "const assembled = await agent(",
  "  \"次を実行し、出力をそのまま返してください。\\n\\n  pnpm exec tsx \" +",
  "    SCRIPTS + \"/assemble.ts \" + projectDir,",
  "  { label: \"assemble\", phase: \"プロトタイプ\", effort: \"low\" },",
  ")",
  "",
  "return {",
  "  projectDir,",
  "  prototype: projectDir + \"/prototype/index.html\",",
  "  assembled,",
  "}",
  ]
    .join("\n")
    .replace("__WAVES__", JSON.stringify(WAVES))
    .replace(
      "__LABELS__",
      JSON.stringify(
        Object.fromEntries(STEP_ORDER.map((s) => [s, STEP_SPECS[s].label])),
      ),
    )
    .replace("__SCRIPTS__", JSON.stringify(SCRIPTS_DIR));

  return `${BANNER.replace("<!-- ", "// ").replace(" -->", "")}
export const meta = ${JSON.stringify(meta, null, 2)}
${body}
`;
}

/** 生成物ディレクトリを作り直す（消し忘れの残骸を残さない）。 */
function resetDir(dir: string) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** zod スキーマ → JSON Schema。オプションを1箇所に閉じる。 */
const toJsonSchema = (schema: z.ZodType): string =>
  `${JSON.stringify(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }), null, 2)}\n`;

// --- 生成 ---------------------------------------------------------------

mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(WORKFLOWS_DIR, { recursive: true });
resetDir(SCHEMA_DIR); // 親の REF_DIR もここで作られる

// 既存の mvp-*.md は一旦削除（工程名の変更で孤児が残るのを防ぐ）。
for (const f of readdirSync(AGENTS_DIR)) {
  if (/^mvp-.*\.md$/.test(f)) rmSync(join(AGENTS_DIR, f));
}

for (const step of STEP_ORDER) {
  writeFileSync(join(AGENTS_DIR, `mvp-${step}.md`), agentMarkdown(step));
  writeFileSync(
    join(SCHEMA_DIR, `${step}.json`),
    toJsonSchema(STEP_SPECS[step].schema),
  );
}
writeFileSync(join(REF_DIR, "waves.md"), wavesMarkdown());

// --- プロトタイプ（Phase 2） ---------------------------------------------

writeFileSync(
  join(AGENTS_DIR, "mvp-orchestrate.md"),
  orchestrateAgentMarkdown(),
);
writeFileSync(
  join(SCHEMA_DIR, "orchestrate.json"),
  toJsonSchema(orchestratePlanSchema),
);
writeFileSync(join(AGENTS_DIR, "mvp-screen.md"), screenAgentMarkdown());
writeFileSync(join(AGENTS_DIR, "mvp-theme.md"), themeAgentMarkdown());
writeFileSync(join(SCHEMA_DIR, "theme.json"), toJsonSchema(themeSchema));
// 画面生成エージェントに Read させる daisyUI リファレンス。
// 本体は同じ文字列をプロンプトに直接埋めている（daisyui-reference.ts が単一ソース）。
writeFileSync(join(WORKFLOWS_DIR, "mvp-pipeline.js"), workflowScript());
writeFileSync(
  join(REF_DIR, "daisyui.md"),
  `${banner("src/lib/prototype-ds/daisyui-reference.ts")}\n\n${DAISYUI_REFERENCE}\n`,
);

console.log(
  `generated: ${STEP_ORDER.length + 3} agents (${AGENTS_DIR}/mvp-*.md), ${STEP_ORDER.length + 2} schemas (${SCHEMA_DIR}), ${REF_DIR}/waves.md, ${REF_DIR}/daisyui.md, ${WORKFLOWS_DIR}/mvp-pipeline.js`,
);
