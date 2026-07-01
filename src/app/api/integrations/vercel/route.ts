/**
 * Vercel 連携の解除（所有者セッション限定）。
 * Vercel 側の installation（configuration）を best-effort で uninstall してから
 * 自分の connection 行を削除する。Vercel 側解除に失敗しても DB 行は必ず消す。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { disconnect } from "@/lib/vercel-oauth";

export const runtime = "nodejs";

export async function DELETE(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { uninstalled } = await disconnect(user.id);
  return NextResponse.json({ ok: true, uninstalled });
}
