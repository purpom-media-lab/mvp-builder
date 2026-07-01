/**
 * Vercel 連携状態の取得（所有者セッション限定・UI 表示用）。
 * トークンは返さず、連携の有無・チーム・表示名と、設定済みかのフラグのみ返す。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  getConnectionStatus,
  isVercelOAuthConfigured,
} from "@/lib/vercel-oauth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const configured = isVercelOAuthConfigured();
  const status = configured
    ? await getConnectionStatus(user.id)
    : { connected: false, teamId: null, vercelUser: null };

  return NextResponse.json({ configured, ...status });
}
