/**
 * プロジェクト永続化（DB層・サーバ専用）
 *
 * すべて ownerId（Better Auth user.id）でスコープし、他ユーザーのデータに触れさせない。
 */
import { and, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  actors,
  backendSpecs,
  brandDesign,
  chatMessages,
  dataModelEntities,
  designRequests,
  engineerRequests,
  journeys,
  kpiMetrics,
  mvpEndUsers,
  mvpRecords,
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
  DesignBriefOutput,
  EngineerBriefOutput,
  GrowthOutput,
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
  | "growth"
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

/**
 * MVP管理用: プロジェクト一覧に「公開MVPの有無・エンドユーザー数・保存データ数」を付与。
 */
export async function listProjectsWithStats(ownerId: string) {
  const rows = await listProjects(ownerId);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  const [protoRows, recCounts, userCounts] = await Promise.all([
    db
      .select({ projectId: prototypes.projectId })
      .from(prototypes)
      .where(
        and(inArray(prototypes.projectId, ids), isNotNull(prototypes.html)),
      ),
    db
      .select({ projectId: mvpRecords.projectId, c: count() })
      .from(mvpRecords)
      .where(inArray(mvpRecords.projectId, ids))
      .groupBy(mvpRecords.projectId),
    db
      .select({ projectId: mvpEndUsers.projectId, c: count() })
      .from(mvpEndUsers)
      .where(inArray(mvpEndUsers.projectId, ids))
      .groupBy(mvpEndUsers.projectId),
  ]);

  const hasHtml = new Set(protoRows.map((p) => p.projectId));
  const recMap = new Map(recCounts.map((r) => [r.projectId, Number(r.c)]));
  const userMap = new Map(userCounts.map((r) => [r.projectId, Number(r.c)]));

  return rows.map((r) => ({
    ...r,
    hasPrototype: hasHtml.has(r.id),
    recordCount: recMap.get(r.id) ?? 0,
    endUserCount: userMap.get(r.id) ?? 0,
  }));
}

/** プロジェクト削除（所有者検証つき）。関連テーブルは FK cascade で消える。 */
export async function deleteProject(ownerId: string, projectId: string) {
  const res = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.ownerId, ownerId)))
    .returning({ id: projects.id });
  return res.length > 0;
}

/** 入力ソース種別（source_documents.type と対応） */
export type SourceType = "text" | "url" | "pdf";

export async function createProject(
  ownerId: string,
  data: {
    name: string;
    summary?: string;
    /** ユーザー入力の「詳細（入力資料/intake）」。projects.detail に保存。 */
    detail?: string;
    /** プレーンテキスト入力（後方互換）。projects.detail に保存。 */
    sourceText?: string;
    /** 抽出済みソース（URL/PDF など）。source_documents に保存（PDF/URL 専用）。 */
    source?: { type: SourceType; title?: string; rawText: string };
  },
) {
  // 手入力テキスト（type=text）は projects.detail へ。url/pdf 抽出のみ source_documents へ。
  const textIntake =
    data.detail ??
    (data.source?.type === "text" ? data.source.rawText : undefined) ??
    data.sourceText;

  const [project] = await db
    .insert(projects)
    .values({
      ownerId,
      name: data.name,
      summary: data.summary ?? null,
      detail: textIntake?.trim() ? textIntake : null,
    })
    .returning();

  // URL/PDF の抽出ソースのみ source_documents（参考資料）へ保存。
  const refSource =
    data.source && data.source.type !== "text" ? data.source : null;
  if (refSource && refSource.rawText.trim()) {
    await db.insert(sourceDocuments).values({
      projectId: project.id,
      type: refSource.type,
      title: refSource.title ?? null,
      rawText: refSource.rawText,
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
    // ユーザー入力の詳細（intake）と、JTBD等の分析結果は projects 直下で別管理。
    detail: project.detail ?? "",
    analysisResult: project.analysisResult ?? null,
    // 参考資料（URL/PDF 抽出テキスト）は source_documents から。
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
    },
    growthPlan: project.growthPlan ?? null,
    brand: brandRows[0] ?? null,
    prototype: prototypeRows[0] ?? null,
    deck: project.deck ?? null,
  };
}

/**
 * ジョブ理論インタビューで整理した要望を、プロジェクトの概要＋入力資料に反映する。
 * 所有権が無ければ false。
 */
export async function saveRequirement(
  ownerId: string,
  projectId: string,
  data: { summary?: string; requirement: string },
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return false;
  // 分析結果（構造化要望）は projects.analysisResult へ。ユーザー入力の detail は上書きしない。
  // summary（一言要約）は任意で更新。
  await db
    .update(projects)
    .set({
      ...(data.summary ? { summary: data.summary } : {}),
      analysisResult: data.requirement,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
  return true;
}

/** プロジェクトの基本情報（概要・詳細/intake）を更新する。所有権が無ければ false。 */
export async function updateProjectInfo(
  ownerId: string,
  projectId: string,
  data: { summary?: string | null; detail?: string | null },
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return false;
  const patch: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (data.summary !== undefined) patch.summary = data.summary;
  if (data.detail !== undefined) patch.detail = data.detail;
  await db.update(projects).set(patch).where(eq(projects.id, projectId));
  return true;
}

/** チャット会話履歴を保存（projectId × scope ごとに1スレッドを洗い替え）。 */
export async function saveChatThread(
  projectId: string,
  scope: string,
  messages: unknown[],
) {
  await db
    .delete(chatMessages)
    .where(
      and(
        eq(chatMessages.projectId, projectId),
        eq(chatMessages.scope, scope),
      ),
    );
  await db.insert(chatMessages).values({ projectId, scope, messages });
}

/** チャット会話履歴を読み込む。所有権が無ければ null。 */
export async function loadChatThread(
  ownerId: string,
  projectId: string,
  scope: string,
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return null;
  const [row] = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.projectId, projectId),
        eq(chatMessages.scope, scope),
      ),
    );
  return (row?.messages as unknown[] | undefined) ?? [];
}

/** 提案資料（slideData 配列）を保存する。所有権が無ければ false。 */
export async function saveDeck(
  ownerId: string,
  projectId: string,
  deck: unknown[],
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return false;
  await db
    .update(projects)
    .set({ deck, updatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return true;
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
    | GrowthOutput
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
            phase: s.phase ?? undefined,
            action: s.action,
            touchpoint: s.touchpoint ?? undefined,
            emotion: s.emotion ?? undefined,
            painpoint: s.painpoint ?? undefined,
            opportunity: s.opportunity ?? undefined,
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
    // screenType は navigation を正とする: 同名画面(label===screenName)が
    // ナビにあれば、その screenType で上書きして二重管理のズレを防ぐ。
    const navRows = await db
      .select({
        label: navigationItems.label,
        screenType: navigationItems.screenType,
      })
      .from(navigationItems)
      .where(eq(navigationItems.projectId, projectId));
    const navScreenType = new Map(
      navRows.map((n) => [n.label.trim(), n.screenType]),
    );
    await db.delete(wireframes).where(eq(wireframes.projectId, projectId));
    if (r.screens.length) {
      await db.insert(wireframes).values(
        r.screens.map((s) => ({
          projectId,
          screenName: s.screenName,
          layout: {
            screenType:
              navScreenType.get(s.screenName.trim()) ?? s.screenType,
            targetObject: s.targetObject ?? null,
            layoutPattern: s.layoutPattern ?? null,
            sections: s.sections,
          },
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
          initialCost: f.initialCost ?? null,
          operationCost: f.operationCost ?? null,
          learningCost: f.learningCost ?? null,
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
  } else if (step === "growth") {
    const r = result as GrowthOutput;
    await db
      .update(projects)
      .set({ growthPlan: r })
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
      paletteOptions: r.paletteOptions ?? null,
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

/** デザイナー連携: リファイン依頼（デザインブリーフ＋成果物参照）。所有権が無ければ null。
 *  1プロジェクト1行を部分マージで洗い替え（brief だけ保存→後から成果物URLを追記、等）。 */
export async function saveDesignRequest(
  ownerId: string,
  projectId: string,
  data: {
    brief?: DesignBriefOutput | null;
    status?: "draft" | "requested" | "received";
    figmaUrl?: string | null;
    pdfName?: string | null;
    pdfData?: string | null;
    refinedNote?: string | null;
  },
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return null;

  const existing = (
    await db
      .select()
      .from(designRequests)
      .where(eq(designRequests.projectId, projectId))
  )[0];

  const merged = {
    projectId,
    brief: data.brief !== undefined ? data.brief : (existing?.brief ?? null),
    status: data.status ?? existing?.status ?? "draft",
    figmaUrl:
      data.figmaUrl !== undefined ? data.figmaUrl : (existing?.figmaUrl ?? null),
    pdfName:
      data.pdfName !== undefined ? data.pdfName : (existing?.pdfName ?? null),
    pdfData:
      data.pdfData !== undefined ? data.pdfData : (existing?.pdfData ?? null),
    refinedNote:
      data.refinedNote !== undefined
        ? data.refinedNote
        : (existing?.refinedNote ?? null),
    updatedAt: new Date(),
  };

  await db
    .delete(designRequests)
    .where(eq(designRequests.projectId, projectId));
  const [row] = await db.insert(designRequests).values(merged).returning();
  return row;
}

/** デザイナー連携: リファイン依頼を読み込む。所有権が無ければ null（未作成なら undefined 相当の null）。 */
export async function loadDesignRequest(ownerId: string, projectId: string) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return null;
  const [row] = await db
    .select()
    .from(designRequests)
    .where(eq(designRequests.projectId, projectId));
  return row ?? null;
}

/** エンジニア連携: 開発依頼（エンジニアブリーフ）。所有権が無ければ null。
 *  1プロジェクト1行を部分マージで洗い替え（brief だけ保存→後から status 更新、等）。 */
export async function saveEngineerRequest(
  ownerId: string,
  projectId: string,
  data: {
    brief?: EngineerBriefOutput | null;
    status?: "draft" | "requested";
  },
) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return null;

  const existing = (
    await db
      .select()
      .from(engineerRequests)
      .where(eq(engineerRequests.projectId, projectId))
  )[0];

  const brief =
    data.brief !== undefined ? data.brief : (existing?.brief ?? null);

  const merged = {
    projectId,
    brief,
    // deliverable / deadline は brief から派生（一覧・検索用の冗長カラム）
    deliverable: brief?.deliverable ?? existing?.deliverable ?? "repo",
    deadline: brief?.deadline ?? existing?.deadline ?? null,
    status: data.status ?? existing?.status ?? "draft",
    updatedAt: new Date(),
  };

  await db
    .delete(engineerRequests)
    .where(eq(engineerRequests.projectId, projectId));
  const [row] = await db.insert(engineerRequests).values(merged).returning();
  return row;
}

/** エンジニア連携: 開発依頼を読み込む。所有権が無ければ null（未作成なら null）。 */
export async function loadEngineerRequest(ownerId: string, projectId: string) {
  const owned = await getOwnedProject(ownerId, projectId);
  if (!owned) return null;
  const [row] = await db
    .select()
    .from(engineerRequests)
    .where(eq(engineerRequests.projectId, projectId));
  return row ?? null;
}

/**
 * 公開ランタイム用: projectId が実在するかだけを確認する（所有権チェック無し）。
 * 「本実装」ホスティング/データAPI は公開なので、所有者を問わず存在判定だけ行う。
 */
export async function projectExists(projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId));
  return Boolean(row);
}

/**
 * 公開ランタイム用: 保存済みプロトタイプ HTML を所有権チェック無しで読む。
 * 公開ホスティング(`/run/[projectId]`)で配信するために使う。
 * プロジェクトが無い場合は null、HTML 未生成の場合は { exists, html: null } を返す。
 */
export async function loadPrototypeHtmlPublic(
  projectId: string,
): Promise<{ exists: boolean; html: string | null }> {
  const exists = await projectExists(projectId);
  if (!exists) return { exists: false, html: null };
  const [row] = await db
    .select({ html: prototypes.html })
    .from(prototypes)
    .where(eq(prototypes.projectId, projectId));
  return { exists: true, html: row?.html ?? null };
}
