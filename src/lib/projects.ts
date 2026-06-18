/**
 * プロジェクト永続化（DB層・サーバ専用）
 *
 * すべて ownerId（Better Auth user.id）でスコープし、他ユーザーのデータに触れさせない。
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  actors,
  backendSpecs,
  brandDesign,
  dataModelEntities,
  journeys,
  kpiMetrics,
  navigationItems,
  oouiObjects,
  projects,
  prototypes,
  scopeItems,
  sourceDocuments,
  useCases,
  wireframes,
} from "@/lib/db/schema";
import type {
  ActorsOutput,
  BackendSpecOutput,
  BrandOutput,
  DataModelOutput,
  JourneyOutput,
  KpiOutput,
  NavigationOutput,
  OouiOutput,
  ScopeOutput,
  UseCasesOutput,
  WireframeOutput,
} from "@/lib/ai/schemas";

export type StepKey =
  | "actors"
  | "usecases"
  | "ooui"
  | "journey"
  | "navigation"
  | "wireframe"
  | "datamodel"
  | "backend"
  | "scope"
  | "kpi"
  | "brand";

/** 所有権チェック（無ければ null） */
async function getOwnedProject(ownerId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)));
  return row ?? null;
}

export async function listProjects(ownerId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.ownerId, ownerId))
    .orderBy(desc(projects.updatedAt));
}

/** 入力ソース種別（source_documents.type と対応） */
export type SourceType = "text" | "url" | "pdf";

export async function createProject(
  ownerId: string,
  data: {
    name: string;
    summary?: string;
    /** プレーンテキスト入力（後方互換: type "text" として保存） */
    sourceText?: string;
    /** 抽出済みソース（URL/PDF など）を直接渡す場合に使用 */
    source?: { type: SourceType; title?: string; rawText: string };
  },
) {
  const [project] = await db
    .insert(projects)
    .values({ ownerId, name: data.name, summary: data.summary ?? null })
    .returning();

  // 抽出済みソース優先。無ければ従来の sourceText を text として保存。
  const source =
    data.source ??
    (data.sourceText?.trim()
      ? { type: "text" as const, rawText: data.sourceText }
      : null);

  if (source && source.rawText.trim()) {
    await db.insert(sourceDocuments).values({
      projectId: project.id,
      type: source.type,
      title: source.title ?? null,
      rawText: source.rawText,
    });
  }
  return project;
}

export async function getProjectWithArtifacts(
  ownerId: string,
  projectId: string,
) {
  const project = await getOwnedProject(ownerId, projectId);
  if (!project) return null;

  const [
    actorRows,
    useCaseRows,
    oouiRows,
    journeyRows,
    navRows,
    wireframeRows,
    dataModelRows,
    backendRows,
    scopeRows,
    kpiRows,
    brandRows,
    prototypeRows,
    sourceRows,
  ] = await Promise.all([
    db.select().from(actors).where(eq(actors.projectId, projectId)),
    db.select().from(useCases).where(eq(useCases.projectId, projectId)),
    db.select().from(oouiObjects).where(eq(oouiObjects.projectId, projectId)),
    db.select().from(journeys).where(eq(journeys.projectId, projectId)),
    db
      .select()
      .from(navigationItems)
      .where(eq(navigationItems.projectId, projectId))
      .orderBy(navigationItems.sortOrder),
    db.select().from(wireframes).where(eq(wireframes.projectId, projectId)),
    db
      .select()
      .from(dataModelEntities)
      .where(eq(dataModelEntities.projectId, projectId)),
    db.select().from(backendSpecs).where(eq(backendSpecs.projectId, projectId)),
    db
      .select()
      .from(scopeItems)
      .where(eq(scopeItems.projectId, projectId))
      .orderBy(scopeItems.sortOrder),
    db
      .select()
      .from(kpiMetrics)
      .where(eq(kpiMetrics.projectId, projectId))
      .orderBy(kpiMetrics.sortOrder),
    db.select().from(brandDesign).where(eq(brandDesign.projectId, projectId)),
    db.select().from(prototypes).where(eq(prototypes.projectId, projectId)),
    db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.projectId, projectId)),
  ]);

  return {
    project,
    sourceText: sourceRows[0]?.rawText ?? "",
    actors: actorRows,
    useCases: useCaseRows,
    ooui: oouiRows,
    journey: journeyRows,
    navigation: navRows,
    wireframes: wireframeRows,
    dataModel: dataModelRows,
    backend: backendRows[0] ?? null,
    scope: scopeRows,
    mvpStatement: project.mvpStatement ?? null,
    kpi: {
      northStar: kpiRows.find((k) => k.kind === "north_star") ?? null,
      supporting: kpiRows.filter((k) => k.kind === "supporting"),
      growthPlan: project.growthPlan ?? null,
    },
    brand: brandRows[0] ?? null,
    prototype: prototypeRows[0] ?? null,
  };
}

/** 工程の生成結果を保存（同種は洗い替え）。所有権が無ければ false。 */
export async function saveStepResult(
  ownerId: string,
  projectId: string,
  step: StepKey,
  result:
    | ActorsOutput
    | UseCasesOutput
    | OouiOutput
    | JourneyOutput
    | NavigationOutput
    | WireframeOutput
    | DataModelOutput
    | BackendSpecOutput
    | ScopeOutput
    | KpiOutput
    | BrandOutput,
): Promise<boolean> {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return false;

  if (step === "actors") {
    const r = result as ActorsOutput;
    await db.delete(actors).where(eq(actors.projectId, projectId));
    if (r.actors.length) {
      await db.insert(actors).values(
        r.actors.map((a) => ({
          projectId,
          name: a.name,
          description: a.description,
          kind: a.kind,
        })),
      );
    }
  } else if (step === "usecases") {
    const r = result as UseCasesOutput;
    await db.delete(useCases).where(eq(useCases.projectId, projectId));
    if (r.useCases.length) {
      await db.insert(useCases).values(
        r.useCases.map((u) => ({
          projectId,
          goal: u.goal,
          description: `${u.actorName}: ${u.description}`,
        })),
      );
    }
  } else if (step === "ooui") {
    const r = result as OouiOutput;
    await db.delete(oouiObjects).where(eq(oouiObjects.projectId, projectId));
    if (r.objects.length) {
      await db.insert(oouiObjects).values(
        r.objects.map((o) => ({
          projectId,
          name: o.name,
          attributes: o.attributes,
          actions: o.actions,
          collectionOf: o.collectionOf,
          relations: o.relations,
        })),
      );
    }
  } else if (step === "journey") {
    const r = result as JourneyOutput;
    await db.delete(journeys).where(eq(journeys.projectId, projectId));
    if (r.journeys.length) {
      await db.insert(journeys).values(
        r.journeys.map((j) => ({
          projectId,
          name: j.name,
          steps: j.steps.map((s) => ({
            step: s.step,
            touchpoint: s.touchpoint ?? undefined,
            emotion: s.emotion ?? undefined,
          })),
        })),
      );
    }
  } else if (step === "navigation") {
    const r = result as NavigationOutput;
    await db
      .delete(navigationItems)
      .where(eq(navigationItems.projectId, projectId));
    if (r.items.length) {
      await db.insert(navigationItems).values(
        r.items.map((n, i) => ({
          projectId,
          label: n.label,
          targetObject: n.targetObject || null,
          screenType: n.screenType,
          parent: n.parent,
          icon: n.icon,
          sortOrder: i,
        })),
      );
    }
  } else if (step === "wireframe") {
    const r = result as WireframeOutput;
    await db.delete(wireframes).where(eq(wireframes.projectId, projectId));
    if (r.screens.length) {
      await db.insert(wireframes).values(
        r.screens.map((s) => ({
          projectId,
          screenName: s.screenName,
          layout: { screenType: s.screenType, sections: s.sections },
        })),
      );
    }
  } else if (step === "datamodel") {
    const r = result as DataModelOutput;
    await db
      .delete(dataModelEntities)
      .where(eq(dataModelEntities.projectId, projectId));
    if (r.entities.length) {
      await db.insert(dataModelEntities).values(
        r.entities.map((e) => ({
          projectId,
          name: e.name,
          fields: e.fields,
          relations: e.relations,
        })),
      );
    }
  } else if (step === "backend") {
    const r = result as BackendSpecOutput;
    await db.delete(backendSpecs).where(eq(backendSpecs.projectId, projectId));
    await db.insert(backendSpecs).values({
      projectId,
      needsAuth: r.needsAuth,
      needsStorage: r.needsStorage,
      needsDb: r.needsDb,
      externalApis: r.externalApis,
      rationale: r.rationale,
    });
  } else if (step === "scope") {
    const r = result as ScopeOutput;
    await db.delete(scopeItems).where(eq(scopeItems.projectId, projectId));
    if (r.features.length) {
      await db.insert(scopeItems).values(
        r.features.map((f, i) => ({
          projectId,
          name: f.name,
          description: f.description ?? null,
          impact: f.impact,
          effort: f.effort,
          priority: f.priority,
          includedInMvp: f.includedInMvp,
          rationale: f.rationale ?? null,
          sortOrder: i,
        })),
      );
    }
    await db
      .update(projects)
      .set({ mvpStatement: r.mvpStatement })
      .where(eq(projects.id, projectId));
  } else if (step === "kpi") {
    const r = result as KpiOutput;
    await db.delete(kpiMetrics).where(eq(kpiMetrics.projectId, projectId));
    await db.insert(kpiMetrics).values([
      {
        projectId,
        kind: "north_star",
        name: r.northStar.name,
        definition: r.northStar.definition ?? null,
        target: r.northStar.target ?? null,
        unit: r.northStar.unit ?? null,
        cadence: r.northStar.cadence ?? null,
        measurement: r.northStar.measurement ?? null,
        sortOrder: 0,
      },
      ...r.supporting.map((m, i) => ({
        projectId,
        kind: "supporting",
        name: m.name,
        definition: m.definition ?? null,
        target: m.target ?? null,
        unit: m.unit ?? null,
        cadence: m.cadence ?? null,
        measurement: m.measurement ?? null,
        sortOrder: i,
      })),
    ]);
    // グロース計画は projects 行に保存
    await db
      .update(projects)
      .set({ growthPlan: r.growthPlan ?? null })
      .where(eq(projects.id, projectId));
  } else if (step === "brand") {
    const r = result as BrandOutput;
    await db.delete(brandDesign).where(eq(brandDesign.projectId, projectId));
    await db.insert(brandDesign).values({
      projectId,
      brandName: r.brandName ?? null,
      tagline: r.tagline ?? null,
      tone: r.tone,
      palette: r.palette,
      typography: r.typography ?? null,
      logoDirection: r.logoDirection ?? null,
      imageryKeywords: r.imageryKeywords ?? null,
      voice: r.voice ?? null,
    });
  }

  await db
    .update(projects)
    .set({ status: "analyzing", updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return true;
}

/** 生成したプロトタイプ（v0）を保存。所有権が無ければ null。 */
export async function savePrototype(
  ownerId: string,
  projectId: string,
  data: {
    v0ChatId?: string | null;
    demoUrl?: string | null;
    html?: string | null;
  },
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return null;

  // 既存行とマージ（部分保存で他フィールドを失わない）。
  // 例: プレビュー(html)生成 → 後からホスティング(demoUrl)発行、を別アクションで行える。
  const existing = (
    await db.select().from(prototypes).where(eq(prototypes.projectId, projectId))
  )[0];
  const v0ChatId =
    data.v0ChatId !== undefined ? data.v0ChatId : (existing?.v0ChatId ?? null);
  const demoUrl =
    data.demoUrl !== undefined ? data.demoUrl : (existing?.demoUrl ?? null);
  const html = data.html !== undefined ? data.html : (existing?.html ?? null);

  await db.delete(prototypes).where(eq(prototypes.projectId, projectId));
  const [row] = await db
    .insert(prototypes)
    .values({
      projectId,
      v0ChatId,
      demoUrl,
      html,
      status: demoUrl ? "hosted" : html ? "preview-ready" : "failed",
    })
    .returning();

  await db
    .update(projects)
    .set({ status: "generating", updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return row;
}
