import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  createInvitation,
  listInvitations,
  listMembers,
} from "@/lib/invitations";

export const runtime = "nodejs";

/** メンバー一覧＋招待一覧を返す */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [invitations, members] = await Promise.all([
    listInvitations(),
    listMembers(),
  ]);
  return NextResponse.json({ invitations, members });
}

/** 招待を発行し、招待リンクを返す */
export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  if (!body?.email?.trim()) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  try {
    const invitation = await createInvitation(user.id, body.email);
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const inviteUrl = `${base}/invite/${invitation.token}`;
    return NextResponse.json({ invitation, inviteUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "招待の作成に失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
