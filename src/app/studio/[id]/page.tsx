"use client";

/**
 * プロジェクト詳細（Project シングルビュー）＝ 分析パイプライン。
 * タブで各工程の生成・結果閲覧を行い、統合チャットで自動再分析。
 * プロトタイプ生成は /studio/[id]/prototype に分離。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { postJsonKeepalive } from "@/lib/api-client";
import {
  AiConsultPanel,
  type OrchestrateResponse,
} from "@/components/ai-consult-panel";
import { GlobalHeader } from "@/components/global-header";
import { MermaidBlock } from "@/components/mermaid-block";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import { ModelPrefsDialog } from "@/components/model-prefs-dialog";
import {
  getModelForStep,
  loadModelPrefs,
  type ModelPrefs,
  recordUsage,
} from "@/lib/model-prefs";
import { Modal } from "@/components/modal";
import { AiGenerating } from "@/components/ai-generating";
import { LoadingOverlay } from "@/components/spinner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  analysisToFlowchart,
  navigationToScreenFlow,
  oouiToClassDiagram,
} from "@/lib/mermaid-source";
import type {
  ActorView,
  BackendView,
  BrandView,
  DataModelView,
  GrowthPlanView,
  JourneyView,
  KpiMetricView,
  NavView,
  OouiView,
  ScopeFeatureView,
  StepKey,
  UseCaseView,
  WireframeView,
} from "@/lib/studio-types";

type KpiData = {
  northStar: KpiMetricView | null;
  supporting: KpiMetricView[];
};

// ワイヤーフレームのセクション種別（API の wireframeSchema enum と一致させる）
const SECTION_TYPES = [
  "header",
  "toolbar",
  "kpi",
  "chart",
  "table",
  "list",
  "cards",
  "form",
  "detail",
  "sidebar",
  "footer",
  "other",
] as const;

const STEPS: { key: StepKey; label: string }[] = [
  { key: "actors", label: "アクター" },
  { key: "usecases", label: "ユースケース" },
  { key: "ooui", label: "モデリング" },
  { key: "journey", label: "ジャーニー" },
  { key: "navigation", label: "ナビゲーション" },
  { key: "wireframe", label: "ワイヤー" },
  { key: "datamodel", label: "データ設計" },
  { key: "backend", label: "バックエンド" },
  { key: "scope", label: "スコープ" },
  { key: "kpi", label: "KPI" },
  { key: "growth", label: "グロース計画" },
  { key: "brand", label: "デザイン" },
];

/** MVP スコープに含められる機能の上限（資料の「最初に作る10以下」） */
const MVP_LIMIT = 10;

/** 各工程の「これは何か」ヘルプ */
const STEP_HELP: Partial<Record<StepKey, { title: string; body: string }>> = {
  actors: {
    title: "アクターとは",
    body: "システムを使う人や役割（外部システム・AIも含む）です。『誰のためのプロダクトか』を洗い出します。",
  },
  usecases: {
    title: "ユースケースとは",
    body: "各アクターが達成したい目的・タスク（『〜したい』）です。機能ではなく“目的”で捉えます。",
  },
  ooui: {
    title: "モデリングとは",
    body: "プロダクトが扱う『オブジェクト（名詞）』と、その『プロパティ（属性）』『アクション（操作）』を整理する設計です。画面やデータの単位になります。",
  },
  journey: {
    title: "ジャーニーとは",
    body: "アクターが目的を達成するまでの一連の行動・接点・感情の流れです。体験の全体像を掴みます。",
  },
};

/** 工程を 3 カテゴリに整理（一度に見えるタブを絞る） */
const CATEGORIES: { key: string; label: string; steps: StepKey[] }[] = [
  { key: "analyze", label: "分析", steps: ["actors", "usecases", "ooui", "journey"] },
  {
    key: "design",
    label: "設計",
    steps: ["navigation", "wireframe", "datamodel", "backend"],
  },
  { key: "mvp", label: "MVP定義", steps: ["scope", "kpi", "growth", "brand"] },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });
  // 工程ごとのモデル設定（localStorage、projectId 単位）
  const [modelPrefs, setModelPrefs] = useState<ModelPrefs>({});
  const [prefsOpen, setPrefsOpen] = useState(false);

  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [sourceText, setSourceText] = useState("");

  const [actors, setActors] = useState<ActorView[] | null>(null);
  const [useCases, setUseCases] = useState<UseCaseView[] | null>(null);
  const [ooui, setOoui] = useState<OouiView[] | null>(null);
  const [journey, setJourney] = useState<JourneyView[] | null>(null);
  const [nav, setNav] = useState<NavView[] | null>(null);
  const [wireframe, setWireframe] = useState<WireframeView[] | null>(null);
  const [dataModel, setDataModel] = useState<DataModelView[] | null>(null);
  const [backend, setBackend] = useState<BackendView | null>(null);
  const [scope, setScope] = useState<ScopeFeatureView[] | null>(null);
  const [mvpStatement, setMvpStatement] = useState("");
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [growth, setGrowth] = useState<GrowthPlanView | null>(null);
  const [brand, setBrand] = useState<BrandView | null>(null);
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StepKey>("actors");

  const [loading, setLoading] = useState<string | null>(null);
  // チャット相談パネルの busy 状態。loading（工程生成/読込/保存）とは別管理にする。
  // これを loading と共用すると、チャットの onBusyChange(false) が生成中の loading を
  // 即 null に上書きしてしまい、生成ローダーが一瞬で消える不具合になる。
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 何らかの処理中（工程生成・読込・保存・チャット）か。ボタンの無効化判定に使う。
  const busy = loading !== null || chatBusy;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading("load");
      setError(null);
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) throw new Error("プロジェクトの読み込みに失敗しました");
        const d = await res.json();
        if (cancelled) return;
        setName(d.project.name);
        setSummary(d.project.summary ?? "");
        setSourceText(d.sourceText ?? "");
        const a = d.actors.length ? d.actors : null;
        const u = d.useCases.length ? d.useCases : null;
        // 旧データ（attributes/actions が string[]）を {name,label} 形へ正規化
        const normTerms = (arr: unknown): { name: string; label?: string }[] =>
          (Array.isArray(arr) ? arr : []).map((t) =>
            typeof t === "string" ? { name: t } : (t as { name: string }),
          );
        const o = d.ooui.length
          ? d.ooui.map(
              (row: { attributes?: unknown; actions?: unknown }) => ({
                ...row,
                attributes: normTerms(row.attributes),
                actions: normTerms(row.actions),
              }),
            )
          : null;
        const j = d.journey?.length
          ? d.journey.map(
              (row: { name: string; steps?: JourneyView["steps"] }) => ({
                name: row.name,
                steps: row.steps ?? [],
              }),
            )
          : null;
        const dm = d.dataModel?.length
          ? d.dataModel.map(
              (row: {
                name: string;
                fields?: DataModelView["fields"];
                relations?: DataModelView["relations"];
              }) => ({
                name: row.name,
                fields: row.fields ?? [],
                relations: row.relations ?? [],
              }),
            )
          : null;
        const n = d.navigation?.length ? d.navigation : null;
        const w = d.wireframes?.length
          ? d.wireframes.map(
              (row: {
                screenName: string;
                layout?: {
                  screenType?: string | null;
                  sections?: WireframeView["sections"];
                } | null;
              }) => ({
                screenName: row.screenName,
                screenType: row.layout?.screenType ?? null,
                sections: row.layout?.sections ?? [],
              }),
            )
          : null;
        setActors(a);
        setUseCases(u);
        setOoui(o);
        setJourney(j);
        setNav(n);
        setWireframe(w);
        setDataModel(dm);
        setBackend(d.backend ?? null);
        const sc = d.scope?.length ? (d.scope as ScopeFeatureView[]) : null;
        const k =
          d.kpi && (d.kpi.northStar || d.kpi.supporting?.length)
            ? (d.kpi as KpiData)
            : null;
        setScope(sc);
        setMvpStatement(d.mvpStatement ?? "");
        setKpi(k);
        setGrowth(d.growthPlan ?? null);
        setBrand(d.brand ?? null);
        const last = [
          d.brand && "brand",
          d.growthPlan && "growth",
          k && "kpi",
          sc && "scope",
          d.backend && "backend",
          dm && "datamodel",
          w && "wireframe",
          n && "navigation",
          j && "journey",
          o && "ooui",
          u && "usecases",
          a && "actors",
        ].find(Boolean) as StepKey | undefined;
        setActiveTab(last ?? "actors");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "エラー");
      } finally {
        if (!cancelled) setLoading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // 工程ごとのモデル設定を localStorage から復元
  useEffect(() => {
    if (!id) return;
    setModelPrefs(loadModelPrefs(id));
  }, [id]);

  function buildContext(): string {
    return [
      `# プロジェクト: ${name || "(未設定)"}`,
      summary && `## 概要\n${summary}`,
      sourceText && `## 入力資料\n${sourceText}`,
      actors && `## アクター\n${JSON.stringify(actors)}`,
      useCases && `## ユースケース\n${JSON.stringify(useCases)}`,
      ooui && `## OOUIオブジェクト\n${JSON.stringify(ooui)}`,
      journey && `## ジャーニー\n${JSON.stringify(journey)}`,
      nav && `## ナビゲーション\n${JSON.stringify(nav)}`,
      wireframe && `## ワイヤーフレーム\n${JSON.stringify(wireframe)}`,
      dataModel && `## データ設計\n${JSON.stringify(dataModel)}`,
      scope &&
        `## スコープ（確定機能）\n${JSON.stringify({ mvpStatement, features: scope })}`,
      kpi && `## KPI\n${JSON.stringify(kpi)}`,
      growth && `## グロース計画\n${JSON.stringify(growth)}`,
      brand && `## ブランド\n${JSON.stringify(brand)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function runStep(step: StepKey) {
    setLoading(step);
    setError(null);
    // この工程に割り当てられたモデル（未設定なら既定にフォールバック）
    const stepModel = getModelForStep(modelPrefs, step, model);
    // 利用ログ計測（成功/失敗・所要時間）。記録は best-effort で UI に影響させない。
    const t0 = performance.now();
    let ok = false;
    try {
      const data = await postJsonKeepalive<{
        result: {
          actors?: ActorView[];
          useCases?: UseCaseView[];
          objects?: OouiView[];
          journeys?: JourneyView[];
          items?: NavView[];
          screens?: WireframeView[];
          entities?: DataModelView[];
          features?: ScopeFeatureView[];
          mvpStatement?: string;
        };
      }>("/api/analyze", {
        step,
        context: buildContext(),
        provider: stepModel.provider,
        modelId: stepModel.modelId,
        projectId: id,
      });
      const r = data.result;
      if (step === "actors") setActors(r.actors ?? null);
      if (step === "usecases") setUseCases(r.useCases ?? null);
      if (step === "ooui") setOoui(r.objects ?? null);
      if (step === "journey") setJourney(r.journeys ?? null);
      if (step === "navigation") setNav(r.items ?? null);
      if (step === "wireframe") setWireframe(r.screens ?? null);
      if (step === "datamodel") setDataModel(r.entities ?? null);
      if (step === "backend") setBackend(data.result as unknown as BackendView);
      if (step === "scope") {
        setScope(r.features ?? null);
        setMvpStatement(r.mvpStatement ?? "");
      }
      if (step === "kpi") setKpi(data.result as unknown as KpiData);
      if (step === "growth") setGrowth(data.result as unknown as GrowthPlanView);
      if (step === "brand") setBrand(data.result as unknown as BrandView);
      ok = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step,
        provider: stepModel.provider,
        modelId: stepModel.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(null);
    }
  }

  // AIチームで全工程を並列一括生成
  async function runFullPipeline() {
    setLoading("full");
    setError(null);
    // 各工程に割り当てられたモデルのマップを作って送る（未設定は既定に解決）
    const modelByStep = Object.fromEntries(
      STEPS.map((s) => [s.key, getModelForStep(modelPrefs, s.key, model)]),
    ) as Record<StepKey, ModelSelection>;
    // per-step の所要時間はクライアントで取れないため、全体を1件（step:"full"）で記録する。
    const t0 = performance.now();
    let ok = false;
    try {
      const data = await postJsonKeepalive<{
        results: Record<string, unknown>;
      }>("/api/orchestrate/full", {
        projectId: id,
        provider: model.provider,
        modelId: model.modelId,
        modelByStep,
      });
      applyOrchestrate({ results: data.results } as OrchestrateResponse);
      ok = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "一括生成に失敗しました");
    } finally {
      recordUsage(id, {
        step: "full",
        provider: model.provider,
        modelId: model.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(null);
    }
  }

  // 編集可能カードの保存（手動編集を洗い替えで永続化）
  async function saveStep(step: StepKey, result: unknown) {
    setLoading("save");
    setError(null);
    try {
      const res = await fetch("/api/save-step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, step, result }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存に失敗しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  function applyOrchestrate(data: OrchestrateResponse) {
    const r = (data.results ?? {}) as Record<string, unknown>;
    const a = r.actors as { actors?: ActorView[] } | undefined;
    const u = r.usecases as { useCases?: UseCaseView[] } | undefined;
    const o = r.ooui as { objects?: OouiView[] } | undefined;
    const j = r.journey as { journeys?: JourneyView[] } | undefined;
    const dm = r.datamodel as { entities?: DataModelView[] } | undefined;
    const n = r.navigation as { items?: NavView[] } | undefined;
    const w = r.wireframe as { screens?: WireframeView[] } | undefined;
    const b = r.backend as BackendView | undefined;
    const sc = r.scope as
      | { features?: ScopeFeatureView[]; mvpStatement?: string }
      | undefined;
    const k = r.kpi as KpiData | undefined;
    const gr = r.growth as GrowthPlanView | undefined;
    const br = r.brand as BrandView | undefined;
    if (a?.actors) setActors(a.actors);
    if (u?.useCases) setUseCases(u.useCases);
    if (o?.objects) setOoui(o.objects);
    if (j?.journeys) setJourney(j.journeys);
    if (dm?.entities) setDataModel(dm.entities);
    if (n?.items) setNav(n.items);
    if (w?.screens) setWireframe(w.screens);
    if (b) setBackend(b);
    if (sc?.features) {
      setScope(sc.features);
      if (sc.mvpStatement) setMvpStatement(sc.mvpStatement);
    }
    if (k) setKpi(k);
    if (gr) setGrowth(gr);
    if (br) setBrand(br);
  }

  const hasData: Record<StepKey, boolean> = {
    actors: !!actors,
    usecases: !!useCases,
    ooui: !!ooui,
    journey: !!journey?.length,
    navigation: !!nav,
    wireframe: !!wireframe,
    datamodel: !!dataModel?.length,
    backend: !!backend,
    scope: !!scope?.length,
    kpi: !!(kpi?.northStar || kpi?.supporting?.length),
    growth: !!growth,
    brand: !!brand,
  };

  const activeCategory =
    CATEGORIES.find((c) => c.steps.includes(activeTab)) ?? CATEGORIES[0];

  const screenFlow = useMemo(
    () => (nav?.length ? navigationToScreenFlow(nav) : null),
    [nav],
  );

  const classDiagram = useMemo(
    () => (ooui?.length ? oouiToClassDiagram(ooui) : null),
    [ooui],
  );
  const flowchart = useMemo(() => {
    if (!(actors?.length || useCases?.length)) return null;
    const actorNames = new Set((actors ?? []).map((a) => a.name));
    const resolved = (useCases ?? []).map((u) => {
      let actorName = u.actorName ?? null;
      if (!actorName && u.description) {
        const cut = u.description.search(/[:：]/);
        if (cut > 0) {
          const prefix = u.description.slice(0, cut).trim();
          if (actorNames.has(prefix)) actorName = prefix;
        }
      }
      return { goal: u.goal, actorName };
    });
    return analysisToFlowchart(actors ?? [], resolved);
  }, [actors, useCases]);

  const GenerateButton = () => (
    <div className="mb-4 space-y-3">
      <Button onClick={() => runStep(activeTab)} disabled={busy}>
        {loading === activeTab
          ? "生成中…"
          : hasData[activeTab]
            ? "AIで再生成"
            : "AIで生成"}
      </Button>
      {loading === activeTab && (
        <AiGenerating
          label={STEPS.find((s) => s.key === activeTab)?.label}
        />
      )}
      {error && loading === null && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <span>⚠️ {error}</span>
          <button
            type="button"
            onClick={() => runStep(activeTab)}
            className="shrink-0 font-semibold underline underline-offset-2 hover:opacity-80"
          >
            再試行
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative min-h-screen bg-background">
      {loading === "load" && <LoadingOverlay label="プロジェクトを読み込み中…" />}
      <GlobalHeader
        back={{ href: "/studio", label: "プロジェクト一覧" }}
        center={
          <span className="text-sm font-medium text-foreground">
            {name || "読み込み中…"}
          </span>
        }
        right={
          <div className="flex items-center gap-3">
            <ModelSelector value={model} onChange={setModel} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPrefsOpen(true)}
              title="工程ごとに使うモデル（速い/賢い）を設定します"
            >
              ⚙️ モデル設定
            </Button>
            <Link
              href={`/studio/${id}/deck`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              資料 →
            </Link>
            <Link
              href={`/studio/${id}/prototype`}
              className={buttonVariants({ size: "sm" })}
            >
              プロトタイプ →
            </Link>
          </div>
        }
      />

      <main className="mx-auto max-w-5xl px-6 py-8">
        {error && (
          <div className="mb-6 rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* プロジェクト情報 */}
        <section className="mb-8 space-y-3">
          <Input
            placeholder="概要（一言で）"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
          <Textarea
            className="h-24"
            placeholder="入力資料（アイデア・要件・参考テキストを貼り付け）"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              各ステップの結果は自動で保存されます
            </p>
            <div className="flex items-center gap-2">
              <Link
                href={`/studio/${id}/intake`}
                title="ジョブ理論（JTBD）で「状況・成し遂げたい進歩」を整理し、機能の取捨選択とMVPの絞り込みに役立てます"
                className={buttonVariants({ size: "sm", variant: "outline" })}
              >
                🧭 ジョブ理論で要望を深掘り
              </Link>
              <Button
                size="sm"
                onClick={runFullPipeline}
                disabled={busy}
                title="アクター/UX/データ/PM/ブランドなど専門ロールのAIが、依存関係を保ちつつ並列で全工程を一気に生成します"
              >
                {loading === "full" ? "AIチーム生成中…" : "🤝 AIチームで一括生成"}
              </Button>
            </div>
          </div>
          {loading === "full" && (
            <AiGenerating
              label="MVP設計一式"
              messages={[
                "ビジネスアナリストが要件を整理しています",
                "UXデザイナーが体験を設計しています",
                "データアーキテクトが構造を組んでいます",
                "PM がスコープと KPI を確定しています",
                "ブランドデザイナーが世界観を整えています",
              ]}
            />
          )}
        </section>

        {/* 統合チャット */}
        {id && (
          <div className="mb-8">
            <AiConsultPanel
              projectId={id}
              model={model}
              busy={loading !== null}
              onBusyChange={setChatBusy}
              onResults={applyOrchestrate}
            />
          </div>
        )}

        {/* ステップタブ */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as StepKey)}
        >
          {/* カテゴリ進捗（分析 / 設計 / MVP定義）。完了状況をプログレスで可視化 */}
          <div className="mb-3 grid grid-cols-3 gap-2">
            {CATEGORIES.map((c) => {
              const isActive = c.key === activeCategory.key;
              const total = c.steps.length;
              const done = c.steps.filter((k) => hasData[k]).length;
              const complete = done === total;
              const pct = Math.round((done / total) * 100);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    if (!c.steps.includes(activeTab)) setActiveTab(c.steps[0]);
                  }}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${
                    isActive
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{c.label}</span>
                    <span
                      className={`flex items-center gap-1 text-xs ${
                        complete
                          ? "font-semibold text-primary"
                          : "text-muted-foreground"
                      }`}
                    >
                      {complete ? "✓ 完了" : `${done}/${total}`}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* 選択カテゴリの工程だけ表示 */}
          <TabsList className="w-full justify-start">
            {STEPS.map((s, i) =>
              activeCategory.steps.includes(s.key) ? (
                <TabsTrigger key={s.key} value={s.key} className="gap-1">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  {s.label}
                  {loading === s.key ? (
                    <span className="text-primary">⏳</span>
                  ) : hasData[s.key] ? (
                    <span className="text-primary">✓</span>
                  ) : null}
                </TabsTrigger>
              ) : null,
            )}
          </TabsList>

          {STEP_HELP[activeTab] && (
            <div className="mt-3 flex gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              <span className="shrink-0">ℹ️</span>
              <p className="text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {STEP_HELP[activeTab]?.title}
                </span>
                {" — "}
                {STEP_HELP[activeTab]?.body}
              </p>
            </div>
          )}

          <Card className="mt-3">
            <CardContent>
              <TabsContent value="actors">
                <GenerateButton />
                {actors ? (
                  <div className="space-y-2">
                    {actors.map((a, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-md border p-2"
                      >
                        <div className="grid flex-1 gap-1.5 sm:grid-cols-[1fr_120px]">
                          <Input
                            className="h-8 font-medium"
                            value={a.name}
                            onChange={(e) =>
                              setActors((cur) =>
                                (cur ?? []).map((x, j) =>
                                  j === i ? { ...x, name: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <Input
                            className="h-8"
                            placeholder="kind"
                            value={a.kind ?? ""}
                            onChange={(e) =>
                              setActors((cur) =>
                                (cur ?? []).map((x, j) =>
                                  j === i ? { ...x, kind: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <Textarea
                            className="h-14 sm:col-span-2"
                            placeholder="説明"
                            value={a.description ?? ""}
                            onChange={(e) =>
                              setActors((cur) =>
                                (cur ?? []).map((x, j) =>
                                  j === i
                                    ? { ...x, description: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="削除"
                          onClick={() =>
                            setActors((cur) =>
                              (cur ?? []).filter((_, j) => j !== i),
                            )
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setActors((cur) => [
                            ...(cur ?? []),
                            { name: "新しいアクター", kind: "primary", description: "" },
                          ])
                        }
                      >
                        ＋ アクター追加
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          saveStep("actors", {
                            actors: (actors ?? []).map((a) => ({
                              name: a.name,
                              description: a.description ?? "",
                              kind: (a.kind ?? "primary") as
                                | "primary"
                                | "secondary"
                                | "system",
                            })),
                          })
                        }
                      >
                        {loading === "save" ? "保存中…" : "変更を保存"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="usecases">
                <GenerateButton />
                {useCases ? (
                  <div className="space-y-2">
                    {useCases.map((u, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 rounded-md border p-2"
                      >
                        <div className="grid flex-1 gap-1.5 sm:grid-cols-[160px_1fr]">
                          <Input
                            className="h-8"
                            placeholder="アクター"
                            value={u.actorName ?? ""}
                            onChange={(e) =>
                              setUseCases((cur) =>
                                (cur ?? []).map((x, j) =>
                                  j === i
                                    ? { ...x, actorName: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                          <Input
                            className="h-8 font-medium"
                            placeholder="目的（〜する）"
                            value={u.goal}
                            onChange={(e) =>
                              setUseCases((cur) =>
                                (cur ?? []).map((x, j) =>
                                  j === i ? { ...x, goal: e.target.value } : x,
                                ),
                              )
                            }
                          />
                          <Textarea
                            className="h-14 sm:col-span-2"
                            placeholder="概要"
                            value={u.description ?? ""}
                            onChange={(e) =>
                              setUseCases((cur) =>
                                (cur ?? []).map((x, j) =>
                                  j === i
                                    ? { ...x, description: e.target.value }
                                    : x,
                                ),
                              )
                            }
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="削除"
                          onClick={() =>
                            setUseCases((cur) =>
                              (cur ?? []).filter((_, j) => j !== i),
                            )
                          }
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setUseCases((cur) => [
                            ...(cur ?? []),
                            { actorName: "", goal: "新しいユースケース", description: "" },
                          ])
                        }
                      >
                        ＋ ユースケース追加
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          saveStep("usecases", {
                            useCases: (useCases ?? []).map((u) => ({
                              actorName: u.actorName ?? "",
                              goal: u.goal,
                              description: u.description ?? "",
                            })),
                          })
                        }
                      >
                        {loading === "save" ? "保存中…" : "変更を保存"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="ooui">
                <GenerateButton />
                {ooui ? (
                  <>
                    <div className="space-y-2">
                      {ooui.map((o, i) => (
                        <div
                          key={i}
                          className="overflow-hidden rounded-lg border"
                        >
                          {/* オブジェクト名（クラス図のヘッダ相当） */}
                          <div className="flex items-center gap-2 border-b bg-muted/50 px-2 py-1.5">
                            <Input
                              className="h-8 border-transparent bg-transparent font-heading font-semibold shadow-none focus-visible:bg-background"
                              value={o.name}
                              onChange={(e) =>
                                setOoui((cur) =>
                                  (cur ?? []).map((x, j) =>
                                    j === i ? { ...x, name: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="削除"
                              onClick={() =>
                                setOoui((cur) =>
                                  (cur ?? []).filter((_, j) => j !== i),
                                )
                              }
                            >
                              ✕
                            </Button>
                          </div>
                          {/* プロパティ */}
                          <div className="space-y-1 px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold tracking-wide text-muted-foreground">
                                プロパティ
                              </span>
                              <span className="text-[0.7rem] text-muted-foreground/60">
                                ({o.attributes?.length ?? 0})
                              </span>
                            </div>
                            {o.attributes?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {o.attributes.map((attr, k) => (
                                  <Badge key={k} variant="secondary">
                                    {attr.label
                                      ? `${attr.label}（${attr.name}）`
                                      : attr.name}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            <Input
                              className="h-8"
                              placeholder="英名をカンマ区切りで（日本語名はAI生成で付与）"
                              value={(o.attributes ?? [])
                                .map((a) => a.name)
                                .join(", ")}
                              onChange={(e) =>
                                setOoui((cur) =>
                                  (cur ?? []).map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          attributes: e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter(Boolean)
                                            .map(
                                              (n) =>
                                                (x.attributes ?? []).find(
                                                  (a) => a.name === n,
                                                ) ?? { name: n },
                                            ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                          {/* アクション */}
                          <div className="space-y-1 border-t px-2 py-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold tracking-wide text-primary">
                                アクション
                              </span>
                              <span className="text-[0.7rem] text-muted-foreground/60">
                                ({o.actions?.length ?? 0})
                              </span>
                            </div>
                            {o.actions?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {o.actions.map((act, k) => (
                                  <Badge
                                    key={k}
                                    variant="outline"
                                    className="border-primary/40 text-primary"
                                  >
                                    {act.label
                                      ? `${act.label}（${act.name}）`
                                      : `${act.name}()`}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                            <Input
                              className="h-8"
                              placeholder="英名をカンマ区切りで（日本語名はAI生成で付与）"
                              value={(o.actions ?? [])
                                .map((a) => a.name)
                                .join(", ")}
                              onChange={(e) =>
                                setOoui((cur) =>
                                  (cur ?? []).map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          actions: e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter(Boolean)
                                            .map(
                                              (n) =>
                                                (x.actions ?? []).find(
                                                  (a) => a.name === n,
                                                ) ?? { name: n },
                                            ),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </div>
                        </div>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setOoui((cur) => [
                              ...(cur ?? []),
                              {
                                name: "新しいオブジェクト",
                                attributes: [],
                                actions: [],
                                collectionOf: null,
                                relations: [],
                              },
                            ])
                          }
                        >
                          ＋ オブジェクト追加
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            saveStep("ooui", {
                              objects: (ooui ?? []).map((o) => ({
                                name: o.name,
                                attributes: o.attributes ?? [],
                                actions: o.actions ?? [],
                                collectionOf: o.collectionOf ?? null,
                                relations: o.relations ?? [],
                              })),
                            })
                          }
                        >
                          {loading === "save" ? "保存中…" : "変更を保存"}
                        </Button>
                        {(classDiagram || flowchart) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDiagramsOpen(true)}
                          >
                            📊 図を表示
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="journey">
                <GenerateButton />
                {journey ? (
                  <div className="space-y-3">
                    {journey.map((jr, i) => (
                      <div key={i} className="rounded-md border p-3">
                        <div className="mb-2 font-semibold">{jr.name}</div>
                        <ol className="space-y-1.5">
                          {jr.steps.map((s, j) => (
                            <li
                              key={j}
                              className="rounded border border-dashed bg-muted/30 px-2 py-1.5 text-sm"
                            >
                              <div className="flex items-start gap-2">
                                <span className="font-medium text-muted-foreground">
                                  {j + 1}.
                                </span>
                                <div className="flex-1">
                                  <span className="font-medium">{s.step}</span>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {s.touchpoint && (
                                      <Badge variant="secondary">
                                        接点: {s.touchpoint}
                                      </Badge>
                                    )}
                                    {s.emotion && (
                                      <Badge variant="outline">
                                        感情: {s.emotion}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="navigation">
                <GenerateButton />
                {nav ? (
                  <div className="space-y-2">
                    {nav.map((n, i) => {
                      const set = (patch: Partial<NavView>) =>
                        setNav((cur) =>
                          (cur ?? []).map((x, j) =>
                            j === i ? { ...x, ...patch } : x,
                          ),
                        );
                      return (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-md border p-2"
                        >
                          <Input
                            className="h-8 w-12 text-center"
                            placeholder="🔣"
                            value={n.icon ?? ""}
                            onChange={(e) => set({ icon: e.target.value })}
                          />
                          <Input
                            className="h-8 flex-1 font-medium"
                            placeholder="メニュー名"
                            value={n.label}
                            onChange={(e) => set({ label: e.target.value })}
                          />
                          <Input
                            className="h-8 w-28"
                            placeholder="種別"
                            value={n.screenType ?? ""}
                            onChange={(e) => set({ screenType: e.target.value })}
                          />
                          <Input
                            className="h-8 w-40"
                            placeholder="対応オブジェクト"
                            value={n.targetObject ?? ""}
                            onChange={(e) =>
                              set({ targetObject: e.target.value })
                            }
                          />
                          <Input
                            className="h-8 w-28"
                            placeholder="親メニュー"
                            value={n.parent ?? ""}
                            onChange={(e) =>
                              set({ parent: e.target.value || null })
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="削除"
                            onClick={() =>
                              setNav((cur) =>
                                (cur ?? []).filter((_, j) => j !== i),
                              )
                            }
                          >
                            ✕
                          </Button>
                        </div>
                      );
                    })}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setNav((cur) => [
                            ...(cur ?? []),
                            {
                              label: "新しいメニュー",
                              screenType: "list",
                              targetObject: "",
                              parent: null,
                              icon: "",
                            },
                          ])
                        }
                      >
                        ＋ メニュー追加
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          saveStep("navigation", {
                            items: (nav ?? []).map((n) => ({
                              label: n.label,
                              targetObject: n.targetObject ?? "",
                              screenType: (n.screenType ?? "other") as
                                | "dashboard"
                                | "list"
                                | "detail"
                                | "form"
                                | "other",
                              parent: n.parent ?? null,
                              icon: n.icon ?? null,
                            })),
                          })
                        }
                      >
                        {loading === "save" ? "保存中…" : "変更を保存"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="wireframe">
                <GenerateButton />
                {wireframe ? (
                  <div className="space-y-3">
                    {wireframe.map((scr, i) => {
                      const setScreen = (patch: Partial<WireframeView>) =>
                        setWireframe((cur) =>
                          (cur ?? []).map((x, k) =>
                            k === i ? { ...x, ...patch } : x,
                          ),
                        );
                      const setSection = (
                        si: number,
                        patch: Partial<WireframeView["sections"][number]>,
                      ) =>
                        setScreen({
                          sections: scr.sections.map((s, k) =>
                            k === si ? { ...s, ...patch } : s,
                          ),
                        });
                      return (
                        <div key={i} className="rounded-md border p-3">
                          <div className="mb-2 flex items-center gap-2">
                            <Input
                              className="h-8 flex-1 font-semibold"
                              placeholder="画面名"
                              value={scr.screenName}
                              onChange={(e) =>
                                setScreen({ screenName: e.target.value })
                              }
                            />
                            <Input
                              className="h-8 w-32"
                              placeholder="種別"
                              value={scr.screenType ?? ""}
                              onChange={(e) =>
                                setScreen({
                                  screenType: e.target.value || null,
                                })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="画面を削除"
                              onClick={() =>
                                setWireframe((cur) =>
                                  (cur ?? []).filter((_, k) => k !== i),
                                )
                              }
                            >
                              ✕
                            </Button>
                          </div>
                          <div className="space-y-1.5">
                            {scr.sections.map((s, j) => (
                              <div
                                key={j}
                                className="flex items-start gap-2 rounded border border-dashed bg-muted/30 p-2"
                              >
                                <div className="grid flex-1 gap-1.5 sm:grid-cols-[120px_1fr]">
                                  <select
                                    className="h-8 rounded-md border bg-background px-2 text-sm"
                                    value={s.type}
                                    onChange={(e) =>
                                      setSection(j, { type: e.target.value })
                                    }
                                  >
                                    {SECTION_TYPES.map((t) => (
                                      <option key={t} value={t}>
                                        {t}
                                      </option>
                                    ))}
                                  </select>
                                  <Input
                                    className="h-8"
                                    placeholder="見出し/説明"
                                    value={s.label}
                                    onChange={(e) =>
                                      setSection(j, { label: e.target.value })
                                    }
                                  />
                                  <Input
                                    className="h-8 sm:col-span-2"
                                    placeholder="主要要素（カンマ区切り）"
                                    value={(s.items ?? []).join(", ")}
                                    onChange={(e) =>
                                      setSection(j, {
                                        items: e.target.value
                                          .split(",")
                                          .map((x) => x.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                  />
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="セクションを削除"
                                  onClick={() =>
                                    setScreen({
                                      sections: scr.sections.filter(
                                        (_, k) => k !== j,
                                      ),
                                    })
                                  }
                                >
                                  ✕
                                </Button>
                              </div>
                            ))}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setScreen({
                                  sections: [
                                    ...scr.sections,
                                    {
                                      type: "other",
                                      label: "新しいセクション",
                                      items: [],
                                    },
                                  ],
                                })
                              }
                            >
                              ＋ セクション追加
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setWireframe((cur) => [
                            ...(cur ?? []),
                            {
                              screenName: "新しい画面",
                              screenType: "list",
                              sections: [],
                            },
                          ])
                        }
                      >
                        ＋ 画面追加
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          saveStep("wireframe", {
                            screens: (wireframe ?? []).map((scr) => ({
                              screenName: scr.screenName,
                              screenType: scr.screenType ?? null,
                              sections: scr.sections.map((s) => ({
                                type: s.type as WireframeView["sections"][number]["type"],
                                label: s.label,
                                items: s.items ?? [],
                              })),
                            })),
                          })
                        }
                      >
                        {loading === "save" ? "保存中…" : "変更を保存"}
                      </Button>
                      {screenFlow && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDiagramsOpen(true)}
                        >
                          🗺 画面遷移図を表示
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="datamodel">
                <GenerateButton />
                {dataModel ? (
                  <div className="space-y-3">
                    {dataModel.map((ent, i) => (
                      <div key={i} className="rounded-md border p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-semibold">{ent.name}</span>
                          {ent.relations?.map((r, k) => (
                            <Badge key={k} variant="outline">
                              {r.type} → {r.to}
                            </Badge>
                          ))}
                        </div>
                        <div className="space-y-1">
                          {ent.fields.map((f, j) => (
                            <div
                              key={j}
                              className="flex items-center gap-2 rounded border border-dashed bg-muted/30 px-2 py-1 text-sm"
                            >
                              <span className="font-medium">{f.name}</span>
                              <span className="text-muted-foreground">
                                : {f.type}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              <TabsContent value="backend">
                <GenerateButton />
                {backend ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex gap-2">
                      <Badge variant={backend.needsAuth ? "default" : "secondary"}>
                        認証 {backend.needsAuth ? "要" : "不要"}
                      </Badge>
                      <Badge
                        variant={backend.needsStorage ? "default" : "secondary"}
                      >
                        ストレージ {backend.needsStorage ? "要" : "不要"}
                      </Badge>
                      <Badge variant={backend.needsDb ? "default" : "secondary"}>
                        DB {backend.needsDb ? "要" : "不要"}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{backend.rationale}</p>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              {/* スコープ確定: 100 → ≤10 の選定 */}
              <TabsContent value="scope">
                <GenerateButton />
                {scope ? (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        このMVPで検証する仮説・提供価値
                      </p>
                      <Textarea
                        className="h-16"
                        value={mvpStatement}
                        onChange={(e) => setMvpStatement(e.target.value)}
                      />
                    </div>
                    {(() => {
                      const selected = scope.filter(
                        (f) => f.includedInMvp,
                      ).length;
                      const over = selected > MVP_LIMIT;
                      return (
                        <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                          <span>
                            MVPに含む機能{" "}
                            <span
                              className={
                                over
                                  ? "font-bold text-destructive"
                                  : "font-bold text-primary"
                              }
                            >
                              {selected}
                            </span>{" "}
                            / 最初に作るのは {MVP_LIMIT} 以下
                          </span>
                          {over && (
                            <span className="text-xs text-destructive">
                              絞り込みましょう
                            </span>
                          )}
                        </div>
                      );
                    })()}
                    <ul className="space-y-2">
                      {scope.map((f, i) => (
                        <li
                          key={i}
                          className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                            f.includedInMvp ? "border-primary/40 bg-primary/5" : ""
                          }`}
                        >
                          <Button
                            size="sm"
                            variant={f.includedInMvp ? "default" : "outline"}
                            className="mt-0.5 shrink-0"
                            onClick={() =>
                              setScope(
                                (prev) =>
                                  prev?.map((x, idx) =>
                                    idx === i
                                      ? { ...x, includedInMvp: !x.includedInMvp }
                                      : x,
                                  ) ?? prev,
                              )
                            }
                          >
                            {f.includedInMvp ? "✓ 含む" : "除外"}
                          </Button>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{f.name}</span>
                              <Badge variant="secondary">{f.priority}</Badge>
                              <Badge variant="outline">影響 {f.impact}</Badge>
                            </div>
                            {f.description && (
                              <p className="mt-1 text-sm text-muted-foreground">
                                {f.description}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                              {f.initialCost && (
                                <span className="text-muted-foreground">
                                  初期開発:{" "}
                                  <span className="font-medium text-foreground">
                                    {f.initialCost}
                                  </span>
                                </span>
                              )}
                              {f.operationCost && (
                                <span className="text-muted-foreground">
                                  運用:{" "}
                                  <span className="font-medium text-foreground">
                                    {f.operationCost}
                                  </span>
                                </span>
                              )}
                              {f.learningCost && (
                                <span className="text-muted-foreground">
                                  顧客の学習:{" "}
                                  <span className="font-medium text-foreground">
                                    {f.learningCost}
                                  </span>
                                </span>
                              )}
                            </div>
                            {f.rationale && (
                              <p className="mt-1 text-xs text-muted-foreground/80">
                                判断: {f.rationale}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        saveStep("scope", { mvpStatement, features: scope })
                      }
                    >
                      スコープを保存
                    </Button>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              {/* KPI 設定 */}
              <TabsContent value="kpi">
                <GenerateButton />
                {kpi?.northStar || kpi?.supporting.length ? (
                  <div className="space-y-4">
                    {kpi.northStar && (
                      <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
                        <p className="mb-2 text-xs font-semibold tracking-wide text-primary uppercase">
                          ★ 北極星指標
                        </p>
                        <MetricEditor
                          metric={kpi.northStar}
                          onChange={(m) =>
                            setKpi((prev) =>
                              prev ? { ...prev, northStar: m } : prev,
                            )
                          }
                        />
                      </div>
                    )}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        補助KPI
                      </p>
                      {kpi.supporting.map((m, i) => (
                        <div key={i} className="rounded-lg border p-3">
                          <MetricEditor
                            metric={m}
                            onChange={(nm) =>
                              setKpi((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      supporting: prev.supporting.map((x, idx) =>
                                        idx === i ? nm : x,
                                      ),
                                    }
                                  : prev,
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      disabled={busy || !kpi.northStar}
                      onClick={() =>
                        kpi.northStar &&
                        saveStep("kpi", {
                          northStar: kpi.northStar,
                          supporting: kpi.supporting,
                        })
                      }
                    >
                      KPIを保存
                    </Button>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              {/* グロース計画 */}
              <TabsContent value="growth">
                <GenerateButton />
                {growth ? (
                  <div className="space-y-4">
                    {growth.model && (
                      <p className="text-sm leading-relaxed">{growth.model}</p>
                    )}
                    {growth.levers?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {growth.levers.map((l, i) => (
                          <Badge key={i} variant="secondary">
                            {l}
                          </Badge>
                        ))}
                      </div>
                    ) : null}

                    {/* マイルストーン（到達ステッパー） */}
                    {growth.milestones?.length ? (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          マイルストーン
                        </p>
                        <ol className="flex flex-col gap-4 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:gap-0">
                          {growth.milestones.map((m, i) => {
                            const last = i === growth.milestones!.length - 1;
                            return (
                              <li
                                key={i}
                                className="relative flex flex-1 flex-col items-center px-2 text-center"
                              >
                                {/* 次のノードへの接続線 */}
                                {!last && (
                                  <span className="absolute top-4 left-1/2 hidden h-0.5 w-full bg-primary/30 sm:block" />
                                )}
                                <span
                                  className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-primary-foreground"
                                  style={{ backgroundColor: "var(--primary)" }}
                                >
                                  {last ? "🏁" : i + 1}
                                </span>
                                <span className="mt-2 text-xs font-semibold text-primary">
                                  {m.period}
                                </span>
                                <span className="mt-0.5 text-sm text-foreground">
                                  {m.target}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ) : null}

                    {growth.experiments?.length ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          施策・実験
                        </p>
                        <ol className="space-y-1.5">
                          {growth.experiments.map((ex, i) => (
                            <li
                              key={i}
                              className="rounded-md border bg-background p-2 text-sm"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-primary">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className="font-medium">{ex.title}</span>
                                {ex.effort && (
                                  <Badge variant="outline">工数 {ex.effort}</Badge>
                                )}
                              </div>
                              {ex.hypothesis && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  仮説: {ex.hypothesis}
                                </p>
                              )}
                              {ex.metric && (
                                <p className="text-xs text-muted-foreground">
                                  指標: {ex.metric}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>

              {/* ブランド設計 */}
              <TabsContent value="brand">
                <GenerateButton />
                {brand ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          ブランド名
                        </p>
                        <Input
                          value={brand.brandName ?? ""}
                          onChange={(e) =>
                            setBrand((p) =>
                              p ? { ...p, brandName: e.target.value } : p,
                            )
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          タグライン
                        </p>
                        <Input
                          value={brand.tagline ?? ""}
                          onChange={(e) =>
                            setBrand((p) =>
                              p ? { ...p, tagline: e.target.value } : p,
                            )
                          }
                        />
                      </div>
                    </div>
                    {brand.paletteOptions?.length ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          配色案（クリックで採用）
                        </p>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {brand.paletteOptions.map((opt, i) => {
                            const active = brand.palette?.primary === opt.primary;
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() =>
                                  setBrand((p) =>
                                    p
                                      ? {
                                          ...p,
                                          palette: {
                                            primary: opt.primary,
                                            secondary: opt.secondary,
                                            accent: opt.accent,
                                            neutral: opt.neutral,
                                            background: opt.background,
                                          },
                                        }
                                      : p,
                                  )
                                }
                                className={`rounded-lg border p-2 text-left transition-colors ${
                                  active
                                    ? "border-primary ring-1 ring-primary"
                                    : "hover:border-primary/40"
                                }`}
                              >
                                <div className="flex gap-1">
                                  {[
                                    opt.primary,
                                    opt.secondary,
                                    opt.accent,
                                    opt.neutral,
                                    opt.background,
                                  ]
                                    .filter(Boolean)
                                    .map((c, j) => (
                                      <span
                                        key={j}
                                        className="h-6 flex-1 rounded"
                                        style={{ backgroundColor: c as string }}
                                      />
                                    ))}
                                </div>
                                <p className="mt-1.5 truncate text-xs font-medium">
                                  {opt.name}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        パレット（採用中）
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {(
                          [
                            "primary",
                            "secondary",
                            "accent",
                            "neutral",
                            "background",
                          ] as const
                        ).map((key) => {
                          const val = brand.palette?.[key];
                          if (!val && key !== "primary") return null;
                          return (
                            <label key={key} className="flex items-center gap-2">
                              <input
                                type="color"
                                value={val ?? "#000000"}
                                onChange={(e) =>
                                  setBrand((p) =>
                                    p
                                      ? {
                                          ...p,
                                          palette: {
                                            primary:
                                              p.palette?.primary ?? "#000000",
                                            ...p.palette,
                                            [key]: e.target.value,
                                          },
                                        }
                                      : p,
                                  )
                                }
                                className="h-9 w-9 cursor-pointer rounded-md border"
                              />
                              <span className="text-xs text-muted-foreground">
                                {key}
                                <br />
                                {val}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    {brand.tone?.length ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          トーンマナー
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {brand.tone.map((t) => (
                            <Badge key={t} variant="secondary">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {brand.voice && (
                      <p className="text-sm text-muted-foreground">
                        ボイス: {brand.voice}
                      </p>
                    )}
                    {brand.imageryKeywords?.length ? (
                      <p className="text-xs text-muted-foreground">
                        イメージ: {brand.imageryKeywords.join(" / ")}
                      </p>
                    ) : null}
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => saveStep("brand", brand)}
                    >
                      デザインを保存
                    </Button>
                  </div>
                ) : (
                  <Empty />
                )}
              </TabsContent>
            </CardContent>
          </Card>
        </Tabs>

        {id && (
          <ModelPrefsDialog
            open={prefsOpen}
            onClose={() => setPrefsOpen(false)}
            projectId={id}
            baseModel={model}
            prefs={modelPrefs}
            onSave={setModelPrefs}
          />
        )}

        <Modal
          open={diagramsOpen}
          onClose={() => setDiagramsOpen(false)}
          title="図（mermaid）"
        >
          <div className="space-y-6">
            {screenFlow && (
              <MermaidBlock code={screenFlow} title="画面遷移図" />
            )}
            {flowchart && (
              <MermaidBlock
                code={flowchart}
                title="アクター × ユースケース（フロー図）"
              />
            )}
            {classDiagram && (
              <MermaidBlock
                code={classDiagram}
                title="モデリング（クラス図）"
              />
            )}
          </div>
        </Modal>
      </main>
    </div>
  );
}

function Empty() {
  return (
    <p className="text-sm text-muted-foreground">
      まだ生成されていません。「AIで生成」を押してください。
    </p>
  );
}

/** KPI 1 指標の編集フォーム */
function MetricEditor({
  metric,
  onChange,
}: {
  metric: KpiMetricView;
  onChange: (m: KpiMetricView) => void;
}) {
  return (
    <div className="space-y-2">
      <Input
        className="font-medium"
        placeholder="指標名"
        value={metric.name}
        onChange={(e) => onChange({ ...metric, name: e.target.value })}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder="目標値"
          value={metric.target ?? ""}
          onChange={(e) => onChange({ ...metric, target: e.target.value })}
        />
        <Input
          placeholder="単位"
          value={metric.unit ?? ""}
          onChange={(e) => onChange({ ...metric, unit: e.target.value })}
        />
      </div>
      {metric.definition && (
        <p className="text-xs text-muted-foreground">定義: {metric.definition}</p>
      )}
      {(metric.measurement || metric.cadence) && (
        <p className="text-xs text-muted-foreground">
          計測: {metric.measurement}
          {metric.cadence ? `（${metric.cadence}）` : ""}
        </p>
      )}
    </div>
  );
}
