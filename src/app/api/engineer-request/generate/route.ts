/**
 * エンジニア連携: 開発依頼の「依頼項目（エンジニアブリーフ）」をAIで下書きする。
 *
 * 完成したプロトタイプとプロジェクトの分析・設計結果（スコープ/データ設計/
 * バックエンド要否/ナビゲーション/ワイヤー/KPI 等）を文脈に、エンジニアへ渡す
 * 開発依頼（開発仕様書/チケット）を生成する。
 */
import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/catalog";
import { buildEngineerBriefContext } from "@/lib/ai/project-context";
import { generateEngineerBrief } from "@/lib/ai/steps";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";
import { streamJsonWithHeartbeat } from "@/lib/stream-keepalive";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  projectId?: string;
  provider?: LlmProvider;
  modelId?: string;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.projectId) {
    return NextResponse.json({ error: "projectId は必須です" }, { status: 400 });
  }

  const artifacts = await getProjectWithArtifacts(user.id, body.projectId);
  if (!artifacts) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // ハートビートで接続維持しながら生成（タイムアウト抑制）
  return streamJsonWithHeartbeat(async () => {
    const brief = await generateEngineerBrief({
      context: buildEngineerBriefContext(artifacts),
      provider: body.provider,
      modelId: body.modelId,
    });
    return { brief };
  });
}
