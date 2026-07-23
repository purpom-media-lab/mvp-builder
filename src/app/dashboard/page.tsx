/**
 * ダッシュボード（全 Project 横断の集約ビュー / screenType=dashboard）。
 *
 * Server Component として既存の listProjectsWithStats を直接呼び、横断集計する
 * （新 API は作らない）。daisyUI の stats / table / badge で表示する。
 */
import { count } from "drizzle-orm";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { ClaudeCodeConnect } from "@/components/claude-code-connect";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { user } from "@/lib/db/auth-schema";
import { listProjectsWithStats } from "@/lib/projects";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  analyzing: "分析中",
  designing: "設計中",
  generating: "生成中",
  published: "公開済",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "badge-ghost",
  analyzing: "badge-info",
  designing: "badge-secondary",
  generating: "badge-warning",
  published: "badge-success",
};

const STATUS_ORDER = [
  "draft",
  "analyzing",
  "designing",
  "generating",
  "published",
] as const;

function StatusBadge({ status }: { status?: string | null }) {
  const key = status ?? "draft";
  return (
    <span
      className={cn(
        "badge badge-sm badge-soft whitespace-nowrap",
        STATUS_BADGE[key] ?? "badge-ghost",
      )}
    >
      {STATUS_LABEL[key] ?? key}
    </span>
  );
}

export default async function DashboardPage() {
  const me = await getSessionUser(await headers());
  if (!me) redirect("/sign-in");

  const [projects, memberRows] = await Promise.all([
    listProjectsWithStats(me.id),
    db.select({ c: count() }).from(user),
  ]);

  const memberCount = Number(memberRows[0]?.c ?? 0);
  const total = projects.length;
  const published = projects.filter((p) => p.hasPrototype).length;
  const inProgress = projects.filter(
    (p) =>
      !!p.status &&
      ["analyzing", "designing", "generating"].includes(p.status),
  ).length;
  const endUsers = projects.reduce((s, p) => s + (p.endUserCount ?? 0), 0);
  const records = projects.reduce((s, p) => s + (p.recordCount ?? 0), 0);

  const byStatus = STATUS_ORDER.map((s) => ({
    status: s,
    n: projects.filter((p) => (p.status ?? "draft") === s).length,
  })).filter((x) => x.n > 0);

  const recent = [...projects]
    .sort(
      (a, b) =>
        new Date(b.updatedAt ?? 0).getTime() -
        new Date(a.updatedAt ?? 0).getTime(),
    )
    .slice(0, 5);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-6 py-10">
        <p className="pm-eyebrow">dashboard</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">
          ダッシュボード
        </h1>
        <p className="mt-1 text-sm text-base-content/70">
          すべてのプロジェクトの状況をまとめて把握できます。
        </p>

        {/* 横断 stats */}
        <div className="stats stats-vertical mt-6 w-full border border-base-300 bg-base-100 sm:stats-horizontal">
          <div className="stat">
            <div className="stat-title">総プロジェクト</div>
            <div className="stat-value text-2xl">{total}</div>
          </div>
          <div className="stat">
            <div className="stat-title">公開MVP</div>
            <div className="stat-value text-2xl text-primary">{published}</div>
          </div>
          <div className="stat">
            <div className="stat-title">進行中</div>
            <div className="stat-value text-2xl">{inProgress}</div>
            <div className="stat-desc">分析・設計・生成</div>
          </div>
          <div className="stat">
            <div className="stat-title">メンバー</div>
            <div className="stat-value text-2xl">{memberCount}</div>
          </div>
        </div>

        <div className="stats stats-vertical mt-4 w-full border border-base-300 bg-base-100 sm:stats-horizontal">
          <div className="stat">
            <div className="stat-title">累計エンドユーザー</div>
            <div className="stat-value text-2xl">{endUsers}</div>
            <div className="stat-desc">公開MVP のサインアップ</div>
          </div>
          <div className="stat">
            <div className="stat-title">保存データ</div>
            <div className="stat-value text-2xl">{records}</div>
            <div className="stat-desc">公開MVP のレコード合計</div>
          </div>
        </div>

        {/* status 内訳 */}
        {byStatus.length > 0 && (
          <div className="mt-6">
            <h2 className="font-heading text-sm font-semibold text-base-content/70">
              ステータス内訳
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {byStatus.map((x) => (
                <span
                  key={x.status}
                  className={cn(
                    "badge badge-soft gap-1 whitespace-nowrap",
                    STATUS_BADGE[x.status],
                  )}
                >
                  {STATUS_LABEL[x.status]}
                  <span className="font-semibold">{x.n}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 最近のプロジェクト */}
        <div className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-heading text-sm font-semibold text-base-content/70">
              最近のプロジェクト
            </h2>
            <Link
              href="/studio"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              すべて見る →
            </Link>
          </div>

          {recent.length === 0 ? (
            <div className="rounded-xl border border-dashed border-base-300 bg-base-100 py-12 text-center text-sm text-base-content/70">
              まだプロジェクトがありません。
              <Link
                href="/studio"
                className="text-primary underline-offset-4 hover:underline"
              >
                プロジェクト一覧
              </Link>
              から作成してください。
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>プロジェクト</th>
                    <th>ステータス</th>
                    <th className="text-right">エンドユーザー</th>
                    <th className="text-right">データ</th>
                    <th>更新</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id}>
                      <td className="max-w-[16rem]">
                        <Link
                          href={`/studio/${p.id}`}
                          className="font-medium hover:text-primary hover:underline"
                        >
                          <span className="block truncate">{p.name}</span>
                        </Link>
                      </td>
                      <td>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="text-right tabular-nums">
                        {p.endUserCount ?? 0}
                      </td>
                      <td className="text-right tabular-nums">
                        {p.recordCount ?? 0}
                      </td>
                      <td className="whitespace-nowrap text-base-content/70">
                        {p.updatedAt
                          ? new Date(p.updatedAt).toLocaleDateString("ja-JP")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <ClaudeCodeConnect />
      </div>
    </AppShell>
  );
}
