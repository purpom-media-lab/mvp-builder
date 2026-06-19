/**
 * デザイナー連携: リファイン依頼の「依頼項目（デザインブリーフ）」をAIで下書きする。
 *
 * 完成したプロトタイプとプロジェクトの分析結果（ブランド/スコープ/アクター/
 * ユースケース/ナビゲーション/ワイヤー）を文脈に、デザイナーへ渡すブリーフを生成する。
 */
import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/catalog";
import { generateDesignBrief } from "@/lib/ai/steps";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

type Artifacts = NonNullable<
  Awaited<ReturnType<typeof getProjectWithArtifacts>>
>;

/** デザインブリーフ生成用の文脈（プロトタイプの有無を含む） */
function buildBriefContext(a: Artifacts): string {
  return [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    a.ooui.length && `## OOUIオブジェクト\n${JSON.stringify(a.ooui)}`,
    a.navigation.length && `## ナビゲーション\n${JSON.stringify(a.navigation)}`,
    a.wireframes.length &&
      `## ワイヤーフレーム\n${JSON.stringify(a.wireframes)}`,
    a.scope.length && `## スコープ\n${JSON.stringify(a.scope)}`,
    a.mvpStatement && `## MVPステートメント\n${a.mvpStatement}`,
    a.brand && `## ブランド設計\n${JSON.stringify(a.brand)}`,
    `## プロトタイプ\n${a.prototype ? "クリック可能なプロトタイプが生成済み（このUIをデザイナーがブラッシュアップする前提）" : "プロトタイプ未生成"}`,
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
    const brief = await generateDesignBrief({
      context: buildBriefContext(artifacts),
      provider: body.provider,
      modelId: body.modelId,
    });
    return NextResponse.json({ brief });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "デザインブリーフ生成に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
