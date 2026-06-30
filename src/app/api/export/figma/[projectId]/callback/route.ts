/**
 * Figma プラグインが生成した Figma ファイル URL を受け取り保存する（トークン認可）。
 * プラグインは別オリジンから POST するため CORS を許可。トークンで所有者を特定し、
 * 既存の designRequests.figmaUrl に保存する（パネルから開けるようになる）。
 */
import { NextResponse } from "next/server";
import { verifyExportToken } from "@/lib/export-token";
import { saveDesignRequest } from "@/lib/projects";

export const runtime = "nodejs";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    figmaUrl?: string;
  } | null;
  if (!body?.token || !body?.figmaUrl?.trim())
    return NextResponse.json(
      { error: "token と figmaUrl は必須です" },
      { status: 400, headers: CORS },
    );

  const claims = verifyExportToken(body.token);
  if (!claims || claims.projectId !== projectId)
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers: CORS },
    );

  const saved = await saveDesignRequest(claims.ownerId, projectId, {
    figmaUrl: body.figmaUrl.trim(),
  });
  if (!saved)
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: CORS },
    );

  return NextResponse.json({ ok: true }, { headers: CORS });
}
