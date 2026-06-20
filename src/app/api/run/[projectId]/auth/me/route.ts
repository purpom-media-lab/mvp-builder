/**
 * 公開MVP エンドユーザー: 現在のユーザー取得（公開・projectId スコープ）。
 *
 * GET (Authorization: Bearer <token>) → トークン検証して {id, email, name} を返す。
 * 無効 / 期限切れ / 別プロジェクトのトークンは 401。
 */
import { NextResponse } from "next/server";
import { authedUserId, findEndUserById } from "@/lib/mvp-auth";
import { projectExists } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!(await projectExists(projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const userId = authedUserId(req, projectId);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await findEndUserById(projectId, userId);
  if (!user) {
    // トークンは有効だがユーザーが削除済み等
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ user });
}
