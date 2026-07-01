/**
 * 公開ステージ API: プロジェクトを GitHub / Vercel に引き継ぐ。
 *
 * SCAFFOLD ONLY: トークン未設定時は副作用なしで "not-configured" を返す。
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { projects, prototypes } from "@/lib/db/schema";
import { publishProject } from "@/lib/handoff";
import { injectRuntimeSdk } from "@/lib/mvp-runtime";
import { getDecryptedToken } from "@/lib/vercel-oauth";

export const runtime = "nodejs";

/**
 * ビルダー（BaaS）の絶対オリジンを決める。別オリジン（ユーザーの Vercel）へ配信した
 * MVP から `/api/run/*` を叩くために、SDK に埋め込む絶対URLの基点となる。
 * NEXT_PUBLIC_APP_URL 優先、無ければリクエストのホストから導出。
 */
function resolveAppOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  // 所有権チェック
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.ownerId, user.id)));
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // 既存のプロトタイプ行（あれば html/demoUrl を引き継ぎ材料に使う）
  const [existing] = await db
    .select()
    .from(prototypes)
    .where(eq(prototypes.projectId, id));

  // 連携済みなら、その利用者の Vercel に公開する（未連携は共有 VERCEL_TOKEN にフォールバック）。
  const vercel = await getDecryptedToken(user.id);

  // 別オリジン（ユーザーの Vercel）で配信されるため、SDK/ウィジェットの API 呼び出しを
  // ビルダーの絶対URLに向けて注入する（/api/run/* は CORS 許可済み）。
  // これで公開先が別ドメインでもデータ保存・認証・アップロード・フィードバックが動く。
  const appOrigin = resolveAppOrigin(req);
  const html = existing?.html
    ? injectRuntimeSdk(existing.html, id, appOrigin)
    : null;

  const result = await publishProject({
    projectName: project.name,
    html,
    demoUrl: existing?.demoUrl ?? null,
    vercel,
  });

  const now = new Date();

  // プロトタイプ行を upsert（既存があれば更新、無ければ最小行を挿入）
  if (existing) {
    await db
      .update(prototypes)
      .set({
        githubRepoUrl: result.githubRepoUrl,
        deploymentUrl: result.deploymentUrl,
        status: result.status,
        updatedAt: now,
      })
      .where(eq(prototypes.id, existing.id));
  } else {
    await db.insert(prototypes).values({
      projectId: id,
      githubRepoUrl: result.githubRepoUrl,
      deploymentUrl: result.deploymentUrl,
      status: result.status,
    });
  }

  // 引き継ぎ成功時のみプロジェクトを published に
  if (result.status === "published") {
    await db
      .update(projects)
      .set({ status: "published", updatedAt: now })
      .where(eq(projects.id, id));
  }

  return NextResponse.json(result);
}
