/**
 * 単一ジョブの状態取得。クライアントがポーリングして進捗・結果を購読する。
 * 読み出し時に stale（取り残された running）を error 化する。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const job = await getJob(user.id, id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job });
}
