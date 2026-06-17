import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const data = await getProjectWithArtifacts(user.id, id);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
