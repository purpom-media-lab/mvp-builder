import { NextResponse } from "next/server";
import { generateDeck } from "@/lib/ai/deck";
import type { LlmProvider } from "@/lib/ai/models";
import { buildDeckContext } from "@/lib/ai/project-context";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts, saveDeck } from "@/lib/projects";
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
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400 },
    );
  }

  const project = await getProjectWithArtifacts(user.id, body.projectId);
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const projectId = body.projectId;
  // ハートビートで接続維持しながら生成（タイムアウト抑制）
  return streamJsonWithHeartbeat(async () => {
    const deck = await generateDeck(
      buildDeckContext(project),
      body.provider,
      body.modelId,
    );
    await saveDeck(user.id, projectId, deck);
    return { deck };
  });
}
