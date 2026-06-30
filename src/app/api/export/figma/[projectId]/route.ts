/**
 * Figma エクスポート用 ExportBundle を返す（Approach B / Phase 1）。
 *
 * Figma プラグインがこのエンドポイントを叩いて、プロジェクトのワイヤー＋ブランドを
 * ExportBundle(JSON) として取得し、Figma 上に画面を生成する。
 * 所有者のセッションでガードする（Phase 2 で短命トークン認可も追加予定）。
 *
 * 設計: docs/design/figma-export.md
 */
import { NextResponse } from "next/server";
import { buildExportBundle } from "@/lib/figma-export";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;
  const artifacts = await getProjectWithArtifacts(user.id, projectId);
  if (!artifacts)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bundle = buildExportBundle(artifacts);
  return NextResponse.json(bundle);
}
