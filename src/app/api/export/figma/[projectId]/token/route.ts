/**
 * Figma エクスポート用の短命トークンを発行する（所有者セッション限定）。
 * Studio の「Figma用URLをコピー」がこれを呼び、プラグインに渡す URL を作る。
 */
import { NextResponse } from "next/server";
import { signExportToken } from "@/lib/export-token";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";

export const runtime = "nodejs";

const TTL_SEC = 60 * 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  // 所有権チェック（他人のプロジェクトのトークンは発行しない）。
  const owned = await getProjectWithArtifacts(user.id, projectId);
  if (!owned)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const token = signExportToken(projectId, user.id, TTL_SEC);
  const origin = new URL(req.url).origin;
  return NextResponse.json({
    token,
    url: `${origin}/api/export/figma/${projectId}?token=${token}`,
    callbackUrl: `${origin}/api/export/figma/${projectId}/callback`,
    expiresInSec: TTL_SEC,
  });
}
