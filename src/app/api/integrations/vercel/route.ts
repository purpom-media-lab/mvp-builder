/**
 * Vercel 連携の解除（所有者セッション限定）。
 * 自分の connection 行を削除する（Vercel 側の uninstall は Phase 3 で扱う）。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { deleteConnection } from "@/lib/vercel-oauth";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await deleteConnection(user.id);
  return NextResponse.json({ ok: true });
}
