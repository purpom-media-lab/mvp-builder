/**
 * エンジニア連携: 開発依頼の「依頼項目（エンジニアブリーフ）」をAIで下書きする。
 *
 * 完成したプロトタイプとプロジェクトの分析・設計結果（スコープ/データ設計/
 * バックエンド要否/ナビゲーション/ワイヤー/KPI 等）を文脈に、エンジニアへ渡す
 * 開発依頼（開発仕様書/チケット）を生成する。
 */
import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/catalog";
import { generateEngineerBrief } from "@/lib/ai/steps";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

type Artifacts = NonNullable<
  Awaited<ReturnType<typeof getProjectWithArtifacts>>
>;

/** エンジニアブリーフ生成用の文脈（実装に必要な設計情報を厚めに含める） */
function buildBriefContext(a: Artifacts): string {
  const mvpScope = a.scope.filter((f) => f.includedInMvp);
  return [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.mvpStatement && `## MVPステートメント\n${a.mvpStatement}`,
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    (mvpScope.length ? mvpScope : a.scope).length &&
      `## スコープ（MVPに含む機能を優先）\n${JSON.stringify(
        mvpScope.length ? mvpScope : a.scope,
      )}`,
    a.navigation.length && `## ナビゲーション\n${JSON.stringify(a.navigation)}`,
    a.wireframes.length &&
      `## ワイヤーフレーム\n${JSON.stringify(a.wireframes)}`,
    a.dataModel.length && `## データ設計\n${JSON.stringify(a.dataModel)}`,
    a.backend && `## バックエンド要否判定\n${JSON.stringify(a.backend)}`,
    (a.kpi.northStar || a.kpi.supporting.length) &&
      `## KPI\n${JSON.stringify(a.kpi)}`,
    `## プロトタイプ\n${a.prototype ? "クリック可能なプロトタイプが生成済み（このUIをエンジニアが実装する前提）" : "プロトタイプ未生成"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

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

  try {
    const brief = await generateEngineerBrief({
      context: buildBriefContext(artifacts),
      provider: body.provider,
      modelId: body.modelId,
    });
    return NextResponse.json({ brief });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "開発依頼の生成に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
