/**
 * 非同期生成ジョブの永続化層（サーバ専用）。
 *
 * 生成を HTTP レスポンスから切り離すための状態管理。すべて ownerId でスコープし、
 * 他ユーザーのジョブに触れさせない。実処理（after() で走る生成本体）は
 * lib/jobs-runner.ts、HTTP 入口は app/api/jobs/*。
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { jobs, projects } from "@/lib/db/schema";

export type JobKind =
  | "step"
  | "orchestrate"
  | "prototype"
  | "deck"
  | "design-brief"
  | "engineer-brief"
  | "design-refine";
export type JobStatus = "running" | "done" | "error";
export type JobRow = typeof jobs.$inferSelect;

/**
 * running のまま放置されたジョブを「クラッシュ」とみなす閾値。
 * 生成本体は after() 内で関数の maxDuration(300s) を上限に走るので、それを超えて
 * running の行はインスタンス退避・クラッシュで取り残されたものとして error 化する。
 */
const STALE_MS = 6 * 60 * 1000;

/** プロジェクト所有権チェック（無ければ null） */
async function getOwnedProject(ownerId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  return row ?? null;
}

/**
 * ジョブを作成して running で返す。プロジェクト所有権が無ければ null。
 * 同種（projectId×kind×step）の running ジョブが既にあればそれを返し、二重起動を防ぐ。
 */
export async function createJob(
  ownerId: string,
  input: {
    projectId: string;
    kind: JobKind;
    step?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<{ job: JobRow; reused: boolean } | null> {
  const owned = await getOwnedProject(ownerId, input.projectId);
  if (!owned) return null;

  await reapStale(input.projectId);

  const existing = await findRunning(
    ownerId,
    input.projectId,
    input.kind,
    input.step ?? null,
  );
  if (existing) return { job: existing, reused: true };

  const [job] = await db
    .insert(jobs)
    .values({
      projectId: input.projectId,
      ownerId,
      kind: input.kind,
      step: input.step ?? null,
      status: "running",
      payload: input.payload ?? {},
    })
    .returning();
  return { job, reused: false };
}

/** 同種の running ジョブ（非 stale）を1件返す。 */
export async function findRunning(
  ownerId: string,
  projectId: string,
  kind: JobKind,
  step: string | null,
): Promise<JobRow | null> {
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.ownerId, ownerId),
        eq(jobs.projectId, projectId),
        eq(jobs.kind, kind),
        eq(jobs.status, "running"),
      ),
    )
    .orderBy(desc(jobs.createdAt));
  const match = rows.find((r) => (r.step ?? null) === step);
  return match ?? null;
}

/** ジョブを owner スコープで取得。読み出し時に stale 掃除も兼ねる。 */
export async function getJob(
  ownerId: string,
  jobId: string,
): Promise<JobRow | null> {
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.ownerId, ownerId)));
  if (!row) return null;
  if (row.status === "running" && isStale(row)) {
    const [reaped] = await db
      .update(jobs)
      .set({
        status: "error",
        error: "生成が完了しませんでした（タイムアウト）。もう一度お試しください。",
        finishedAt: new Date(),
      })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
      .returning();
    return reaped ?? { ...row, status: "error" };
  }
  return row;
}

/** プロジェクトのジョブ一覧（owner スコープ）。active=true なら running のみ。 */
export async function listJobs(
  ownerId: string,
  projectId: string,
  opts: { active?: boolean } = {},
): Promise<JobRow[]> {
  await reapStale(projectId);
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.ownerId, ownerId), eq(jobs.projectId, projectId)))
    .orderBy(desc(jobs.createdAt))
    .limit(30);
  return opts.active ? rows.filter((r) => r.status === "running") : rows;
}

/** 進捗をマージ更新し、ハートビートを打つ（running のまま）。 */
export async function updateJobProgress(
  jobId: string,
  progress: Record<string, unknown>,
): Promise<void> {
  const [row] = await db
    .select({ progress: jobs.progress })
    .from(jobs)
    .where(eq(jobs.id, jobId));
  await db
    .update(jobs)
    .set({
      progress: { ...(row?.progress ?? {}), ...progress },
      heartbeatAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

/** ハートビートのみ更新（長い単発生成の生存確認用）。 */
export async function heartbeatJob(jobId: string): Promise<void> {
  await db
    .update(jobs)
    .set({ heartbeatAt: new Date() })
    .where(eq(jobs.id, jobId));
}

/** ジョブを完了にする（結果を保存）。 */
export async function completeJob(
  jobId: string,
  result: unknown,
  progress?: Record<string, unknown>,
): Promise<void> {
  const set: Partial<typeof jobs.$inferInsert> = {
    status: "done",
    result,
    finishedAt: new Date(),
    heartbeatAt: new Date(),
  };
  if (progress) {
    const [row] = await db
      .select({ progress: jobs.progress })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    set.progress = { ...(row?.progress ?? {}), ...progress };
  }
  await db.update(jobs).set(set).where(eq(jobs.id, jobId));
}

/** ジョブを失敗にする。 */
export async function failJob(jobId: string, error: string): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: "error",
      error: error || "生成に失敗しました。もう一度お試しください。",
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    })
    .where(eq(jobs.id, jobId));
}

function isStale(row: JobRow): boolean {
  return Date.now() - new Date(row.createdAt).getTime() > STALE_MS;
}

/** running のまま閾値を超えたジョブを error 化する。 */
export async function reapStale(projectId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  await db
    .update(jobs)
    .set({
      status: "error",
      error: "生成が完了しませんでした（タイムアウト）。もう一度お試しください。",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.projectId, projectId),
        eq(jobs.status, "running"),
        lt(jobs.createdAt, cutoff),
      ),
    );
}
