import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Next.js 16 では middleware が proxy にリネームされた。1プロジェクト1ファイルのみ。
 * 本 proxy は2つの役割を持つ:
 *
 * 1. `/studio/*` の楽観的ルート保護: セッションCookieが無ければ /sign-in へ。
 *    （機微な操作は各 API/サーバ側で auth.api.getSession を使って再検証すること）
 * 2. `/api/run/*` の CORS 付与: 生成 MVP はユーザーの Vercel など別オリジンに配信され、
 *    そこからビルダーの BaaS（データ/認証/アップロード/フィードバック）を呼ぶため。
 *    これらは Cookie ではなく Authorization: Bearer / 匿名 ownerKey で認可する
 *    ＝資格情報付きでないため `Access-Control-Allow-Origin: *` で安全に開放できる。
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,content-type,accept",
  "Access-Control-Max-Age": "86400",
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- /api/run/* : 公開ランタイム API に CORS を付与 ---
  if (pathname.startsWith("/api/run/")) {
    if (request.method === "OPTIONS") {
      // プリフライトはここで完結（204 + CORS）
      return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
    }
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  // --- /studio/* : 楽観的ルート保護 ---
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/studio/:path*", "/api/run/:path*"],
};
