/**
 * 分析成果物の手動編集を保存する（Generative UI / 編集可能カード用）。
 * クライアントで編集した工程の全リストを受け取り、洗い替えで保存する。
 */
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { saveStepResult, type StepKey } from "@/lib/projects";
import type {
  ActorsOutput,
  BackendSpecOutput,
  BrandOutput,
  KpiOutput,
  MarketOutput,
  NavigationOutput,
  OouiOutput,
  ScopeOutput,
  UseCasesOutput,
} from "@/lib/ai/schemas";

interface Body {
  projectId?: string;
  step?: StepKey;
  result?:
    | ActorsOutput
    | UseCasesOutput
    | OouiOutput
    | NavigationOutput
    | BackendSpecOutput
    | ScopeOutput
    | KpiOutput
    | BrandOutput
    | MarketOutput;
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
  if (!body.projectId || !body.step || !body.result) {
    return NextResponse.json(
      { error: "projectId, step, result は必須です" },
      { status: 400 },
    );
  }

  const saved = await saveStepResult(
    user.id,
    body.projectId,
    body.step,
    body.result,
  );
  if (!saved) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ saved: true });
}
