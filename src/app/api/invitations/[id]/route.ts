import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { revokeInvitation } from "@/lib/invitations";

export const runtime = "nodejs";

/** 招待を取り消す（pending のみ） */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await revokeInvitation(id);
  return NextResponse.json({ ok: true });
}
