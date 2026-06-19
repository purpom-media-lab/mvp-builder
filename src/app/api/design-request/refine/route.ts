/**
 * デザイナー連携: 成果物（Figma URL / PDF）を参照してプロトタイプをブラッシュアップする。
 *
 * v1 は「参照ベースの再生成」: デザイナーがリファインしたデザイン（Figma URL / PDF）を
 * 参照デザインとして PrototypeContext.refineReference に注入し、既存の /api/prototype と
 * 同じ AWS(Claude HTML) / v0 経路でプロトタイプを作り直す。
 *
 * TODO: Figma → コードの完全自動化や Figma MCP 連携はスコープ外（将来対応）。
 */
import { NextResponse } from "next/server";
import type { LlmProvider } from "@/lib/ai/models";
import { getSessionUser } from "@/lib/auth/session";
import {
  getProjectWithArtifacts,
  saveDesignRequest,
  savePrototype,
} from "@/lib/projects";
import { generatePrototypeHtml } from "@/lib/prototype-html";
import { createPrototype, type PrototypeContext } from "@/lib/v0";

export const runtime = "nodejs";
export const maxDuration = 300;

type Artifacts = NonNullable<
  Awaited<ReturnType<typeof getProjectWithArtifacts>>
>;

/** 分析成果物 → プロトタイプ生成コンテキスト（プロトタイプ画面と同じ写像） */
function buildPrototypeContext(
  a: Artifacts,
  refineReference: PrototypeContext["refineReference"],
): PrototypeContext {
  return {
    projectName: a.project.name,
    summary: a.project.summary,
    actors: a.actors.map((x) => ({ name: x.name, description: x.description })),
    useCases: a.useCases.map((x) => ({
      goal: x.goal,
      description: x.description,
    })),
    oouiObjects: a.ooui.map((o) => ({
      name: o.name,
      attributes: (o.attributes ?? []).map((at) => at.label ?? at.name),
    })),
    navigation: a.navigation.map((n) => ({
      label: n.label,
      targetObject: n.targetObject,
      screenType: n.screenType,
      parent: n.parent,
      icon: n.icon,
    })),
    mvpStatement: a.mvpStatement,
    scope: a.scope
      .filter((f) => f.includedInMvp)
      .map((f) => ({ name: f.name, description: f.description })),
    kpis: [a.kpi.northStar, ...a.kpi.supporting]
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ name: m.name, target: m.target })),
    brand: a.brand
      ? {
          brandName: a.brand.brandName,
          tagline: a.brand.tagline,
          tone: a.brand.tone,
          palette: a.brand.palette,
          typography: a.brand.typography,
          logoDirection: a.brand.logoDirection,
        }
      : null,
    refineReference,
  };
}

interface Body {
  projectId?: string;
  engine?: "v0" | "aws";
  provider?: LlmProvider;
  modelId?: string;
  /** デザイナー成果物の指定（どちらか一方） */
  figmaUrl?: string;
  pdfName?: string;
  pdfData?: string; // base64（任意・現状は参照メモ扱い）
  note?: string;
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

  const hasFigma = !!body.figmaUrl?.trim();
  const hasPdf = !!body.pdfName?.trim();
  if (!hasFigma && !hasPdf) {
    return NextResponse.json(
      { error: "Figma URL もしくは PDF を指定してください" },
      { status: 400 },
    );
  }

  const artifacts = await getProjectWithArtifacts(user.id, body.projectId);
  if (!artifacts) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const refineReference: PrototypeContext["refineReference"] = hasFigma
    ? { type: "figma", url: body.figmaUrl?.trim(), note: body.note }
    : { type: "pdf", url: body.pdfName?.trim(), note: body.note };

  try {
    const ctx = buildPrototypeContext(artifacts, refineReference);
    const engine = body.engine ?? "aws";

    let result: { html?: string; demoUrl?: string | null };
    if (engine === "v0") {
      const r = await createPrototype(ctx);
      await savePrototype(user.id, body.projectId, {
        v0ChatId: r.chatId,
        demoUrl: r.demoUrl,
      });
      result = { demoUrl: r.demoUrl };
    } else {
      const html = await generatePrototypeHtml(
        ctx,
        body.provider,
        body.modelId,
      );
      await savePrototype(user.id, body.projectId, { html });
      result = { html };
    }

    // 依頼の状態を「成果物受領（received）」に更新し、成果物参照を保存
    await saveDesignRequest(user.id, body.projectId, {
      status: "received",
      figmaUrl: hasFigma ? (body.figmaUrl?.trim() ?? null) : null,
      pdfName: hasPdf ? (body.pdfName?.trim() ?? null) : null,
      pdfData: hasPdf ? (body.pdfData ?? null) : null,
      refinedNote: body.note ?? null,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ブラッシュアップに失敗しました";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
