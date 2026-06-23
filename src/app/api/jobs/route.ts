/**
 * 非同期生成ジョブの入口。
 *
 * POST: ジョブを作成して jobId を即返し、生成本体は after() でレスポンス後も継続する。
 *       これにより画面遷移・リロード・タブ閉じでも生成が止まらない。
 * GET:  ?projectId= でプロジェクトのジョブ一覧（?active=1 で running のみ）。マウント時の
 *       進行中ジョブ復帰に使う。
 */
import { after, NextResponse } from "next/server";
import { isStepKey } from "@/lib/ai/run-step";
import { getSessionUser } from "@/lib/auth/session";
import { createJob, listJobs, type JobKind } from "@/lib/jobs";
import { runJob } from "@/lib/jobs-runner";

export const runtime = "nodejs";
// 生成本体は after() でこの関数内に走る。Fluid Compute 有効化で上限 800 秒まで使える。
// 出力上限（maxOutputTokensFor）も 800 秒内に収まる量にしてある。
export const maxDuration = 800;

const KINDS: JobKind[] = [
  "step",
  "orchestrate",
  "prototype",
  "deck",
  "design-brief",
  "engineer-brief",
  "design-refine",
];

interface Body {
  projectId?: string;
  kind?: JobKind;
  step?: string;
  mode?: "create" | "update" | "realize";
  [key: string]: unknown;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, kind } = body;
  if (!projectId)
    return NextResponse.json({ error: "projectId は必須です" }, { status: 400 });
  if (!kind || !KINDS.includes(kind))
    return NextResponse.json(
      { error: `Unknown kind: ${String(kind)}` },
      { status: 400 },
    );

  // dedupe / 進捗の粒度に使う step を決める。
  let step: string | null = null;
  if (kind === "step") {
    if (!isStepKey(body.step))
      return NextResponse.json(
        { error: `Unknown step: ${String(body.step)}` },
        { status: 400 },
      );
    step = body.step;
  } else if (kind === "prototype") {
    step = body.mode ?? "create";
  }

  const created = await createJob(user.id, {
    projectId,
    kind,
    step,
    payload: body,
  });
  if (!created)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // 既存 running を再利用したときは二重起動しない。
  if (!created.reused) {
    after(() => runJob(created.job));
  }

  return NextResponse.json({ job: created.job, reused: created.reused });
}

export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId)
    return NextResponse.json({ error: "projectId は必須です" }, { status: 400 });
  const active = url.searchParams.get("active") === "1";

  const jobs = await listJobs(user.id, projectId, { active });
  return NextResponse.json({ jobs });
}
