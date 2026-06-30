/**
 * Vercel 連携の開始（所有者セッション限定）。
 *
 * 署名付き state を発行して Cookie に保存し、Vercel のインストールURLへ 302。
 * ユーザーはそこでチームを選んで承認し、callback に戻ってくる。
 * `returnTo`（同一サイト内の相対パス）を渡すと、連携完了後にそこへ戻す。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  OAUTH_STATE_COOKIE,
  buildInstallUrl,
  isVercelOAuthConfigured,
  signState,
} from "@/lib/vercel-oauth";

export const runtime = "nodejs";

/** オープンリダイレクト防止: 同一サイト内の相対パスのみ許可する。 */
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/dashboard";
  // 先頭が "/" かつ "//"（プロトコル相対）でないものだけ許可
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
  return raw;
}

export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isVercelOAuthConfigured()) {
    return NextResponse.json(
      { error: "Vercel 連携が未設定です（管理者に環境変数の設定を依頼してください）" },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const state = signState(user.id);

  const res = NextResponse.redirect(buildInstallUrl(state));
  const secure = url.protocol === "https:";
  // sameSite=lax: Vercel からのトップレベル GET 遷移で Cookie が戻るようにする
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  res.cookies.set("vc_oauth_return", returnTo, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
