/**
 * ビルダー向け: 実ユーザー（回答者）の声の一覧。
 * 所有者チェックあり（自分のプロジェクトのみ）。Phase 2 の集計ビューで使う。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";
import { listUserVoices } from "@/lib/user-voices";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  // 所有者でなければ getProjectWithArtifacts は null を返す。
  const owned = await getProjectWithArtifacts(user.id, id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const voices = await listUserVoices(id);
  return NextResponse.json({ voices });
}
