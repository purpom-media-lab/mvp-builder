import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * 楽観的なルート保護: /studio はセッションCookieが無ければ /sign-in へ。
 * （機微な操作は各 API/サーバ側で auth.api.getSession を使って再検証すること）
 *
 * Next.js 16 では middleware が proxy にリネームされた。
 */
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/studio/:path*"],
};
