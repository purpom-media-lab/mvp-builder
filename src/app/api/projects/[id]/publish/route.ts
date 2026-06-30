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
import { getDecryptedToken } from "@/lib/vercel-oauth";

export const runtime = "nodejs";

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

  const result = await publishProject({
    projectName: project.name,
    html: existing?.html ?? null,
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
