/**
 * エンジニア連携: 開発依頼の保存・読み込み。
 * - POST: エンジニアブリーフ／status を保存（部分マージ）。
 * - GET:  projectId の開発依頼を取得。
 */
import { NextResponse } from "next/server";
import type { EngineerBriefOutput } from "@/lib/ai/schemas";
import { getSessionUser } from "@/lib/auth/session";
import { loadEngineerRequest, saveEngineerRequest } from "@/lib/projects";

export const runtime = "nodejs";

interface Body {
  projectId?: string;
  brief?: EngineerBriefOutput | null;
  status?: "draft" | "requested";
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

  const row = await saveEngineerRequest(user.id, body.projectId, {
    brief: body.brief,
    status: body.status,
  });
  if (!row)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ engineerRequest: row });
}

export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId は必須です" }, { status: 400 });
  }

  const row = await loadEngineerRequest(user.id, projectId);
  // 所有権なし/未作成は null。404 ではなく null を返してフロントで初期化させる。
  return NextResponse.json({ engineerRequest: row });
}
