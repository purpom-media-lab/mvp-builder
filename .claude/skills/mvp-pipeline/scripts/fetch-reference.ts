/**
 * MVP Builder（Web アプリ）の既存プロジェクトを MCP 経由で取得し、
 * 「Claude Code パイプラインへの入力」と「比較用リファレンス」に分けて保存する。
 *
 *   MVP_BUILDER_MCP_URL=... MVP_BUILDER_MCP_TOKEN=... \
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/fetch-reference.ts <projectId|studioURL> <projectDir>
 *
 * 出力:
 *   <projectDir>/reference/project.json … 本体の成果物一式（比較の正解データ）
 *   <projectDir>/project.json           … 入力のみ（name/summary/analysisResult/sourceText）
 *
 * 入力だけを切り出すのが要点。本体の分析結果を見せたまま再分析させると
 * 「写す」だけになり品質比較にならないため、artifacts は reference/ に隔離する。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { usage } from "./_lib";

const args = process.argv.slice(2);
const force = args.includes("--force");
const [projectRef, projectDir] = args.filter((a) => a !== "--force");
const url = process.env.MVP_BUILDER_MCP_URL;
const token = process.env.MVP_BUILDER_MCP_TOKEN;

if (!projectRef || !projectDir || !url || !token) {
  console.error(
    `MVP_BUILDER_MCP_URL=... MVP_BUILDER_MCP_TOKEN=... ${usage("fetch-reference.ts", "<projectId|studioURL> <projectDir> [--force]")}`,
  );
  process.exit(2);
}

// project.json は JTBD 対話で合意した内容が入っている場合がある。黙って潰さない。
const inputFile = join(projectDir, "project.json");
if (existsSync(inputFile) && !force) {
  console.error(
    `${inputFile} が既にある。上書きすると JTBD の合意内容が失われる。\n` +
      `別の <projectDir> を指定するか、消えて構わないなら --force を付ける。\n` +
      `（reference/project.json だけが欲しい場合も、この入力の切り出しは同時に走る）`,
  );
  process.exit(1);
}

let sessionId: string | null = null;

/** Streamable HTTP の 1 リクエスト。SSE で返ることがあるので両対応で読む。 */
async function rpc(method: string, params?: unknown, id?: number) {
  const res = await fetch(url!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, ...(id != null ? { id } : {}) }),
  });
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;
  if (!res.ok) {
    throw new Error(`${method} failed: ${res.status} ${await res.text()}`);
  }
  if (id == null) return null; // 通知（レスポンス本文なし）
  const text = await res.text();
  // SSE 形式（"event: message\ndata: {...}"）でもプレーン JSON でも受け取れるようにする。
  const dataLines = text
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  const payload = dataLines.length ? dataLines.join("") : text;
  const json = JSON.parse(payload);
  if (json.error) throw new Error(`${method} error: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function main() {
  await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mvp-pipeline-fetch", version: "1.0.0" },
    },
    1,
  );
  await rpc("notifications/initialized");

  const result = (await rpc(
    "tools/call",
    { name: "get_project", arguments: { projectId: projectRef } },
    2,
  )) as { content: { type: string; text: string }[] };

  const snapshot = JSON.parse(result.content[0].text);
  if (snapshot.error) {
    console.error(`get_project: ${snapshot.error}`);
    process.exit(1);
  }
  save(snapshot);
}

interface Snapshot {
  project?: { name?: string; summary?: string };
  analysisResult?: string;
  detail?: string;
  sourceText?: string;
  [k: string]: unknown;
}

function save(snapshot: Snapshot) {
  // artifacts/ は各工程のサブエージェントが書く。ここでは作るだけ（空でよい）。
  mkdirSync(join(projectDir, "reference"), { recursive: true });
  mkdirSync(join(projectDir, "artifacts"), { recursive: true });

  writeFileSync(
    join(projectDir, "reference", "project.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );

  // パイプラインへの入力だけを切り出す（本体の分析結果は含めない）。
  const input = {
    name: snapshot.project?.name ?? "",
    summary: snapshot.project?.summary ?? "",
    analysisResult: snapshot.analysisResult ?? "",
    detail: snapshot.detail ?? "",
    sourceText: snapshot.sourceText ?? "",
  };
  writeFileSync(
    join(projectDir, "project.json"),
    `${JSON.stringify(input, null, 2)}\n`,
  );

  const len = (k: string) => (snapshot[k] as unknown[] | undefined)?.length ?? 0;
  console.log(`saved: ${projectDir}/reference/project.json`);
  console.log(`saved: ${projectDir}/project.json (入力のみ)`);
  console.log(
    `入力サイズ: analysisResult=${input.analysisResult.length}字 / detail=${input.detail.length}字 / sourceText=${input.sourceText.length}字`,
  );
  console.log(
    `リファレンス件数: actors=${len("actors")} useCases=${len("useCases")} ooui=${len("ooui")} navigation=${len("navigation")} wireframes=${len("wireframes")} scope=${len("scope")}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
