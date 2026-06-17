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
import { Modal } from "@/components/modal";
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
  DataModelView,
  JourneyView,
  NavView,
  OouiView,
  StepKey,
  UseCaseView,
  WireframeView,
} from "@/lib/studio-types";

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
  { key: "ooui", label: "OOUI" },
  { key: "journey", label: "ジャーニー" },
  { key: "navigation", label: "ナビゲーション" },
  { key: "wireframe", label: "ワイヤー" },
  { key: "datamodel", label: "データ設計" },
  { key: "backend", label: "バックエンド" },
];

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });

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
  const [diagramsOpen, setDiagramsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StepKey>("actors");

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        const o = d.ooui.length ? d.ooui : null;
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
        const last = [
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
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function runStep(step: StepKey) {
    setLoading(step);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step,
          context: buildContext(),
          provider: model.provider,
          modelId: model.modelId,
          projectId: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成に失敗しました");
      if (step === "actors") setActors(data.result.actors);
      if (step === "usecases") setUseCases(data.result.useCases);
      if (step === "ooui") setOoui(data.result.objects);
      if (step === "journey") setJourney(data.result.journeys);
      if (step === "navigation") setNav(data.result.items);
      if (step === "wireframe") setWireframe(data.result.screens);
      if (step === "datamodel") setDataModel(data.result.entities);
      if (step === "backend") setBackend(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
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
    const n = r.navigation as { items?: NavView[] } | undefined;
    const w = r.wireframe as { screens?: WireframeView[] } | undefined;
    const b = r.backend as BackendView | undefined;
    if (a?.actors) setActors(a.actors);
    if (u?.useCases) setUseCases(u.useCases);
    if (o?.objects) setOoui(o.objects);
    if (n?.items) setNav(n.items);
    if (w?.screens) setWireframe(w.screens);
    if (b) setBackend(b);
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
  };

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
    <Button
      onClick={() => runStep(activeTab)}
      disabled={loading !== null}
      className="mb-4"
    >
      {loading === activeTab
        ? "生成中…"
        : hasData[activeTab]
          ? "AIで再生成"
          : "AIで生成"}
    </Button>
  );

  return (
    <div className="min-h-screen bg-background">
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
          <p className="text-xs text-muted-foreground">
            各ステップの結果は自動で Neon に保存されます
          </p>
        </section>

        {/* 統合チャット */}
        {id && (
          <div className="mb-8">
            <AiConsultPanel
              projectId={id}
              model={model}
              busy={loading !== null}
              onBusyChange={(b) => setLoading(b ? "chat" : null)}
              onResults={applyOrchestrate}
            />
          </div>
        )}

        {/* ステップタブ */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as StepKey)}
        >
          <TabsList className="w-full justify-start">
            {STEPS.map((s, i) => (
              <TabsTrigger key={s.key} value={s.key} className="gap-1">
                <span className="text-muted-foreground">{i + 1}.</span>
                {s.label}
                {loading === s.key ? (
                  <span className="text-primary">⏳</span>
                ) : hasData[s.key] ? (
                  <span className="text-green-600">✓</span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>

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
                        disabled={loading !== null}
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
                        disabled={loading !== null}
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
                          className="flex items-start gap-2 rounded-md border p-2"
                        >
                          <div className="flex-1 space-y-1.5">
                            <Input
                              className="h-8 font-medium"
                              value={o.name}
                              onChange={(e) =>
                                setOoui((cur) =>
                                  (cur ?? []).map((x, j) =>
                                    j === i ? { ...x, name: e.target.value } : x,
                                  ),
                                )
                              }
                            />
                            <Input
                              className="h-8"
                              placeholder="属性（カンマ区切り）"
                              value={(o.attributes ?? []).join(", ")}
                              onChange={(e) =>
                                setOoui((cur) =>
                                  (cur ?? []).map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          attributes: e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter(Boolean),
                                        }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <Input
                              className="h-8"
                              placeholder="アクション（カンマ区切り）"
                              value={(o.actions ?? []).join(", ")}
                              onChange={(e) =>
                                setOoui((cur) =>
                                  (cur ?? []).map((x, j) =>
                                    j === i
                                      ? {
                                          ...x,
                                          actions: e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter(Boolean),
                                        }
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
                              setOoui((cur) =>
                                (cur ?? []).filter((_, j) => j !== i),
                              )
                            }
                          >
                            ✕
                          </Button>
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
                          disabled={loading !== null}
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
                        disabled={loading !== null}
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
                        disabled={loading !== null}
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
            </CardContent>
          </Card>
        </Tabs>

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
                title="OOUIオブジェクト（クラス図）"
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
