import { NextResponse } from "next/server";
import { generateDeck } from "@/lib/ai/deck";
import type { LlmProvider } from "@/lib/ai/models";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts, saveDeck } from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  projectId?: string;
  provider?: LlmProvider;
  modelId?: string;
}

/** プロジェクトの成果物 → 提案資料生成用のコンテキスト */
function buildDeckContext(
  p: Awaited<ReturnType<typeof getProjectWithArtifacts>>,
): string {
  if (!p) return "";
  const mvpScope = p.scope.filter((s) => s.includedInMvp);
  return [
    `# プロジェクト: ${p.project.name}`,
    p.project.summary && `## 概要\n${p.project.summary}`,
    p.mvpStatement && `## MVPの仮説・提供価値\n${p.mvpStatement}`,
    p.sourceText && `## 入力資料(抜粋)\n${p.sourceText.slice(0, 2000)}`,
    p.actors.length && `## アクター\n${JSON.stringify(p.actors)}`,
    p.useCases.length && `## ユースケース\n${JSON.stringify(p.useCases)}`,
    mvpScope.length &&
      `## MVPに含む機能(確定スコープ)\n${JSON.stringify(
        mvpScope.map((s) => ({
          name: s.name,
          description: s.description,
          impact: s.impact,
          effort: s.effort,
        })),
      )}`,
    (p.kpi.northStar || p.kpi.supporting.length) &&
      `## KPI\n${JSON.stringify({
        northStar: p.kpi.northStar,
        supporting: p.kpi.supporting,
      })}`,
    p.growthPlan && `## グロース計画\n${JSON.stringify(p.growthPlan)}`,
    p.brand && `## ブランド\n${JSON.stringify(p.brand)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
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
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 },
    );
  }

  const project = await getProjectWithArtifacts(user.id, body.projectId);
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const deck = await generateDeck(
      buildDeckContext(project),
      body.provider,
      body.modelId,
    );
    await saveDeck(user.id, body.projectId, deck);
    return NextResponse.json({ deck });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "資料生成に失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
