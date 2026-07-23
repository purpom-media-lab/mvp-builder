/**
 * Claude Code（MCP クライアント）連携用のパーソナルトークン発行。
 *
 * POST: ログイン中ユーザーの MCP トークン（既定 90 日）を発行し、
 *       /api/mcp に接続するための `claude mcp add` コマンドを添えて返す。
 * トークンはステートレス（DB 保存なし）。再発行すると新しいトークンが返るが、
 * 旧トークンも失効時刻までは有効（無効化は BETTER_AUTH_SECRET のローテーションのみ）。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { signMcpToken } from "@/lib/mcp-token";

export const runtime = "nodejs";

/** NEXT_PUBLIC_APP_URL 優先、無ければリクエストのホストから導出（invitations と同方針）。 */
function resolveOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { token, expiresAt } = signMcpToken(user.id);
  const url = `${resolveOrigin(req)}/api/mcp`;
  const command = `claude mcp add --transport http mvp-builder ${url} --header "Authorization: Bearer ${token}"`;

  return NextResponse.json({ token, url, expiresAt, command });
}
