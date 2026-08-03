/**
 * MVP Builder（Web アプリ）の既存プロジェクトを MCP 経由で取得し、
 * 「Claude Code パイプラインへの入力」と「比較用リファレンス」に分けて保存する。
 *
 *   MVP_BUILDER_MCP_URL=... MVP_BUILDER_MCP_TOKEN=... \
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/fetch-reference.ts <projectId|studioURL> <projectDir> [--force]
 *
 * 出力:
 *   <projectDir>/reference/project.json … 本体の成果物一式（比較の正解データ）
 *   <projectDir>/project.json           … 入力のみ（name/summary/analysisResult/sourceText）
 *
 * 入力だけを切り出すのが要点。本体の分析結果を見せたまま再分析させると
 * 「写す」だけになり品質比較にならないため、artifacts は reference/ に隔離する。
 *
 * 通信は公式 SDK（@modelcontextprotocol/sdk、本 repo の直接依存）に任せる。
 * プロトコルのバージョンネゴシエーション・SSE の解釈・セッション終了を自前で
 * 実装すると、サーバ側（src/app/api/mcp/route.ts の mcp-handler）が上がったときに
 * ここだけ取り残されるため。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

interface Snapshot {
  project?: { name?: string; summary?: string };
  analysisResult?: string;
  detail?: string;
  sourceText?: string;
  [k: string]: unknown;
}

async function fetchSnapshot(): Promise<Snapshot> {
  const client = new Client({ name: "mvp-pipeline-fetch", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url!), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "get_project",
      arguments: { projectId: projectRef },
    });

    const content = result.content as { type: string; text?: string }[] | undefined;
    const text = content?.find((c) => c.type === "text")?.text;
    if (!text) {
      throw new Error(
        `get_project がテキストを返さなかった: ${JSON.stringify(result).slice(0, 300)}`,
      );
    }
    const snapshot = JSON.parse(text) as Snapshot & { error?: string };
    if (snapshot.error) throw new Error(`get_project: ${snapshot.error}`);
    return snapshot;
  } finally {
    // セッションを閉じる（サーバ側の状態を残さない）。
    await client.close();
  }
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

fetchSnapshot()
  .then(save)
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
