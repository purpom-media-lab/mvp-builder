/**
 * クライアント用の非同期ジョブ・ヘルパー。
 *
 * 生成は POST /api/jobs で起動して即 jobId を受け取り、GET /api/jobs/[id] を
 * ポーリングして進捗・結果を購読する。画面を遷移・リロードしても、サーバ側の
 * 生成は after() で継続するため、戻ってきた画面は進行中ジョブを拾い直して
 * 続きの進捗・最終結果を反映できる。
 */
export type JobStatus = "running" | "done" | "error";
export type JobKind = "step" | "orchestrate" | "prototype";

export interface JobView {
  id: string;
  projectId: string;
  kind: JobKind;
  step: string | null;
  status: JobStatus;
  progress: Record<string, unknown>;
  result: unknown;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** ジョブを起動して作成された行を返す。既存 running があればそれを再利用する。 */
export async function startJob(
  input: Record<string, unknown> & {
    projectId: string;
    kind: JobKind;
  },
): Promise<JobView> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error || "生成の開始に失敗しました。もう一度お試しください。",
    );
  }
  return data.job as JobView;
}

/** プロジェクトの進行中ジョブ（running）を取得する（マウント時の復帰用）。 */
export async function fetchActiveJobs(projectId: string): Promise<JobView[]> {
  const res = await fetch(
    `/api/jobs?projectId=${encodeURIComponent(projectId)}&active=1`,
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ jobs: [] }));
  return (data.jobs as JobView[]) ?? [];
}

/**
 * ジョブを完了（done/error）まで購読する。running の間は onProgress を都度呼ぶ。
 * 返り値は最終ジョブ行。status==='error' でも throw せず返すので呼び出し側で判断する。
 * opts.signal が abort されたら購読を中断する（生成自体は止まらない）。
 */
export async function pollJob(
  jobId: string,
  opts: {
    onProgress?: (job: JobView) => void;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<JobView> {
  const intervalMs = opts.intervalMs ?? 1500;
  let netFails = 0;
  while (true) {
    if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
    let job: JobView | null = null;
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { signal: opts.signal });
      if (res.ok) {
        const data = await res.json();
        job = data.job as JobView;
        netFails = 0;
      } else if (res.status === 404) {
        throw new Error("ジョブが見つかりませんでした。");
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // 一時的なネットワーク不調は数回まで許容する
      if (++netFails > 5) {
        throw new Error("通信が不安定です。接続を確認して再読み込みしてください。");
      }
    }
    if (job) {
      if (job.status !== "running") return job;
      opts.onProgress?.(job);
    }
    await sleep(intervalMs, opts.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
