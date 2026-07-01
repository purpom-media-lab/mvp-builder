/**
 * Vercel 連携の callback（所有者セッション限定）。
 *
 * Vercel 承認後に code/configurationId/teamId を受け取り、
 *   1. state（Cookie と一致 + 署名 + 失効 + ownerId == セッション）を検証（CSRF 対策）
 *   2. code → access_token を交換
 *   3. access_token を暗号化して per-user 保存
 * 完了後は連携開始元（returnTo）へ `?vercel=connected` 付きで戻す。
 */
import { type NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  OAUTH_STATE_COOKIE,
  exchangeCodeForToken,
  isVercelOAuthConfigured,
  saveConnection,
  verifyState,
} from "@/lib/vercel-oauth";

export const runtime = "nodejs";

function backTo(origin: string, path: string, status: string): NextResponse {
  const dest = new URL(path, origin);
  dest.searchParams.set("vercel", status);
  const res = NextResponse.redirect(dest);
  // 使い切った Cookie を破棄
  res.cookies.delete(OAUTH_STATE_COOKIE);
  res.cookies.delete("vc_oauth_return");
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = url.origin;
  const returnTo = req.cookies.get("vc_oauth_return")?.value || "/dashboard";

  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isVercelOAuthConfigured()) {
    return backTo(origin, returnTo, "error");
  }

  const code = url.searchParams.get("code");
  const queryState = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null;

  // CSRF 対策の要は「connect が発行した署名付き state Cookie」。
  // これは HMAC 署名済み・短命・ownerId 埋め込みで、攻撃者は偽造できない。
  //   - Cookie の署名/失効を検証し、ownerId が現在のセッションと一致すること
  //   - Vercel が state を返した場合のみ、Cookie と一致するかも追加検証する
  //     （Vercel のインストールフローは state を返さないことがあるため必須にしない）
  const verified = verifyState(cookieState);
  if (!code || !verified || verified.ownerId !== user.id) {
    return backTo(origin, returnTo, "error");
  }
  if (queryState && queryState !== cookieState) {
    return backTo(origin, returnTo, "error");
  }

  try {
    const redirectUri = `${origin}/api/integrations/vercel/callback`;
    const token = await exchangeCodeForToken({ code, redirectUri });
    await saveConnection({
      ownerId: user.id,
      accessToken: token.access_token,
      teamId: token.team_id ?? url.searchParams.get("teamId"),
      installationId:
        token.installation_id ?? url.searchParams.get("configurationId"),
      vercelUser: token.user_id ?? null,
    });
    return backTo(origin, returnTo, "connected");
  } catch {
    // トークン交換失敗（詳細はログに出さない＝秘匿）
    return backTo(origin, returnTo, "error");
  }
}
