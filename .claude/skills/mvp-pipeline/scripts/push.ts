/**
 * Claude Code 版の成果物（artifacts/*.json）を本体（Web アプリ）のプロジェクトへ書き戻す。
 *
 *   MVP_BUILDER_MCP_URL=... MVP_BUILDER_MCP_TOKEN=... \
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/push.ts <projectDir> <projectId|studioURL> [step ...]
 *
 * step を省略すると、存在する成果物すべてを**依存順**に送る。
 *
 * 注意:
 * - 本体側は工程ごとに**洗い替え**（既存を消して入れ直す）。上書きされて困るものが
 *   本体側にあるなら、先に studio で確認すること
 * - **書き込み権限つきのトークンが要る**（ダッシュボードの「Claude Code 連携」で
 *   「書き戻しを許可する」にチェックして再発行）。読み取り専用トークンだと 1 件目で止まる
 * - 送る前に本体と同じ zod スキーマで検証する。壊れた成果物を DB に入れない
 *   （サーバ側でも同じ検証をするが、ここで落とせば往復せずに済む）
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { STEP_ORDER, STEP_SPECS } from "../../../../src/lib/ai/step-specs";
import type { StepKey } from "../../../../src/lib/projects";
import { crossCheckArtifacts, formatZodIssues, usage } from "./_lib";

const [projectDir, projectRef, ...rest] = process.argv.slice(2);
const url = process.env.MVP_BUILDER_MCP_URL;
const token = process.env.MVP_BUILDER_MCP_TOKEN;

if (!projectDir || !projectRef || !url || !token) {
  console.error(
    `MVP_BUILDER_MCP_URL=... MVP_BUILDER_MCP_TOKEN=... ${usage("push.ts", "<projectDir> <projectId|studioURL> [step ...]")}`,
  );
  process.exit(2);
}

const unknown = rest.filter((s) => !(s in STEP_SPECS));
if (unknown.length) {
  console.error(`unknown step(s): ${unknown.join(", ")}`);
  process.exit(2);
}
const requested = rest.filter((s): s is StepKey => s in STEP_SPECS);

/** 送る工程を依存順に決める。指定があればその工程だけ（順序は STEP_ORDER に従う）。 */
const targets = STEP_ORDER.filter(
  (step) =>
    (requested.length === 0 || requested.includes(step)) &&
    existsSync(join(projectDir, "artifacts", `${step}.json`)),
);

if (!targets.length) {
  console.error(
    `${join(projectDir, "artifacts")} に送れる成果物が無い。先に13工程を通すこと。`,
  );
  process.exit(1);
}

// --- 送る前に検証する ------------------------------------------------------

const payloads: { step: StepKey; result: unknown }[] = [];
let invalid = 0;

for (const step of targets) {
  const file = join(projectDir, "artifacts", `${step}.json`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`INVALID  ${step} — JSON として読めない: ${(e as Error).message}`);
    invalid++;
    continue;
  }
  const parsed = STEP_SPECS[step].schema.safeParse(data);
  if (!parsed.success) {
    console.error(`INVALID  ${step} (${STEP_SPECS[step].label}) — ${file}`);
    for (const line of formatZodIssues(parsed.error.issues)) console.error(line);
    invalid++;
    continue;
  }
  payloads.push({ step, result: parsed.data });
}

if (invalid) {
  console.error(
    `\n${invalid} 件がスキーマ不一致。送らずに中止した。該当工程を直してから再実行すること。`,
  );
  process.exit(1);
}

// 工程間の参照ずれは zod を通ってしまうので、送る前に警告する（送信自体は止めない）。
const warnings = crossCheckArtifacts((step) => {
  const f = join(projectDir, "artifacts", `${step}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
});
if (warnings.length) {
  console.warn("⚠ 工程間の整合性");
  for (const w of warnings) console.warn(w);
  console.warn("");
}

// --- 送る ------------------------------------------------------------------

async function main() {
  const client = new Client({ name: "mvp-pipeline-push", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url!), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);

  try {
    console.log(`${payloads.length} 工程を ${projectRef} へ送る（依存順）`);
    for (const { step, result } of payloads) {
      const res = await client.callTool({
        name: "save_step",
        arguments: { projectId: projectRef, step, result },
      });
      const content = res.content as { type: string; text?: string }[] | undefined;
      const text = content?.find((c) => c.type === "text")?.text ?? "";
      const body = text ? (JSON.parse(text) as { ok?: boolean; error?: string; note?: string }) : {};

      if (!body.ok) {
        // 途中で止める。中途半端に混ざった状態を作らないため。
        console.error(`\n✗ ${step}: ${body.error ?? (text || "不明なエラー")}`);
        console.error(
          `${payloads.findIndex((p) => p.step === step)} 件目までは保存済み。原因を直して残りを送り直すこと。`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(`  ✓ ${step} (${STEP_SPECS[step].label})${body.note ? ` — ${body.note}` : ""}`);
    }
    console.log("\n完了。studio で内容を確認してください。");
  } finally {
    await client.close();
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  if (/読み取り専用|Unauthorized/.test(msg)) {
    console.error(
      "\n書き込み権限つきのトークンが要る。ダッシュボードの「Claude Code 連携」で\n" +
        "「書き戻しを許可する」にチェックして再発行し、MVP_BUILDER_MCP_TOKEN を差し替えること。",
    );
  }
  process.exit(1);
});
