/**
 * Figma エクスポート用 ExportBundle を返す（Approach B）。
 *
 * 認可は2系統:
 *  - `?token=` （Phase 2）: 署名付き短命トークン。Figma プラグインが別オリジンから
 *    取得するため CORS を許可する（トークン自体が秘密＝所有権の証明）。
 *  - セッション（Phase 1）: 所有者の Cookie。Studio から直接叩く場合。
 *
 * 設計: docs/design/figma-export.md
 */
import { NextResponse } from "next/server";
import { buildExportBundle } from "@/lib/figma-export";
import { verifyExportToken } from "@/lib/export-token";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const token = new URL(req.url).searchParams.get("token");

  // トークン認可（プラグインからの別オリジン取得）。
  if (token) {
    const claims = verifyExportToken(token);
    if (!claims || claims.projectId !== projectId)
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401, headers: CORS },
      );
    const artifacts = await getProjectWithArtifacts(claims.ownerId, projectId);
    if (!artifacts)
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: CORS },
      );
    return NextResponse.json(buildExportBundle(artifacts), { headers: CORS });
  }

  // セッション認可（Studio から）。
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const artifacts = await getProjectWithArtifacts(user.id, projectId);
  if (!artifacts)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(buildExportBundle(artifacts));
}
