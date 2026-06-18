import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { loadChatThread } from "@/lib/projects";

export const runtime = "nodejs";

/** チャット会話履歴を取得（?projectId=&scope=analysis|jtbd） */
export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const scope = searchParams.get("scope") ?? "analysis";
  if (!projectId)
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const messages = await loadChatThread(user.id, projectId, scope);
  if (messages === null)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ messages });
}
