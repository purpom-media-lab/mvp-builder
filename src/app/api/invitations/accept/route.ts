import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getValidInvitationByToken, markAccepted } from "@/lib/invitations";

export const runtime = "nodejs";

/**
 * 招待を承諾済みにする。サインアップ直後の本人セッションで呼ばれ、
 * トークンが有効かつ本人のメールと一致する場合のみ受理する。
 */
export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { token?: string } | null;
  if (!body?.token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const inv = await getValidInvitationByToken(body.token);
  if (!inv || inv.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return NextResponse.json({ error: "招待が無効です" }, { status: 400 });
  }

  await markAccepted(body.token, user.id);
  return NextResponse.json({ ok: true });
}
