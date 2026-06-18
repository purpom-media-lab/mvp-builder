"use client";

/**
 * プロトタイプ（Prototype シングルビュー）。左ペイン=操作、右ペイン=フルハイトプレビュー。
 * 分析データは /api/projects/[id] から取得して生成に使う。統合チャットからの
 * 自動再分析→UI再生成にも対応。
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import {
  AiConsultPanel,
  type OrchestrateResponse,
} from "@/components/ai-consult-panel";
import { GlobalHeader } from "@/components/global-header";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import type {
  ActorView,
  BrandView,
  KpiMetricView,
  NavView,
  OouiView,
  ScopeFeatureView,
  UseCaseView,
} from "@/lib/studio-types";

export default function PrototypePage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });

  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [actors, setActors] = useState<ActorView[]>([]);
  const [useCases, setUseCases] = useState<UseCaseView[]>([]);
  const [ooui, setOoui] = useState<OouiView[]>([]);
  const [nav, setNav] = useState<NavView[]>([]);
  const [scope, setScope] = useState<ScopeFeatureView[]>([]);
  const [mvpStatement, setMvpStatement] = useState("");
  const [kpi, setKpi] = useState<{
    northStar: KpiMetricView | null;
    supporting: KpiMetricView[];
  } | null>(null);
  const [brand, setBrand] = useState<BrandView | null>(null);

  const [engine, setEngine] = useState<"v0" | "aws">("aws");
  const [instruction, setInstruction] = useState("");
  const [demoUrl, setDemoUrl] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const [publish, setPublish] = useState<{
    status: "published" | "not-configured" | "failed";
    githubRepoUrl: string | null;
    deploymentUrl: string | null;
    message: string;
  } | null>(null);

  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`);
        if (!res.ok) throw new Error("プロジェクトの読み込みに失敗しました");
        const d = await res.json();
        if (cancelled) return;
        setName(d.project.name);
        setSummary(d.project.summary ?? "");
        setActors(d.actors ?? []);
        setUseCases(d.useCases ?? []);
        setOoui(d.ooui ?? []);
        setNav(d.navigation ?? []);
        setScope(d.scope ?? []);
        setMvpStatement(d.mvpStatement ?? "");
        setKpi(d.kpi ?? null);
        setBrand(d.brand ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "エラー");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function generatePrototype(override?: {
    actors?: ActorView[];
    useCases?: UseCaseView[];
    ooui?: OouiView[];
    nav?: NavView[];
    engine?: "v0" | "aws";
  }) {
    const aData = override?.actors ?? actors;
    const ucData = override?.useCases ?? useCases;
    const oData = override?.ooui ?? ooui;
    const navData = override?.nav ?? nav;
    const engineUsed = override?.engine ?? engine;
    setLoading("prototype");
    setError(null);
    try {
      const res = await fetch("/api/prototype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: engineUsed,
          provider: model.provider,
          modelId: model.modelId,
          projectId: id,
          projectName: name,
          summary,
          actors: aData,
          useCases: ucData.map((u) => ({
            goal: u.goal,
            description: u.description,
          })),
          oouiObjects: oData.map((o) => ({
            name: o.name,
            attributes: o.attributes,
          })),
          navigation: navData.map((n) => ({
            label: n.label,
            targetObject: n.targetObject,
            screenType: n.screenType,
            parent: n.parent,
          })),
          mvpStatement,
          // スコープ確定済みなら MVP に含む機能だけを実装対象に渡す
          scope: scope
            .filter((f) => f.includedInMvp)
            .map((f) => ({ name: f.name, description: f.description })),
          kpis: kpi
            ? [kpi.northStar, ...kpi.supporting]
                .filter((m): m is KpiMetricView => !!m)
                .map((m) => ({ name: m.name, target: m.target }))
            : undefined,
          brand: brand
            ? {
                brandName: brand.brandName,
                tagline: brand.tagline,
                tone: brand.tone,
                palette: brand.palette,
                typography: brand.typography,
                logoDirection: brand.logoDirection,
              }
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? "プロトタイプ生成に失敗しました");
      setDemoUrl(data.demoUrl ?? null);
      setHtml(data.html ?? null);
      setShareUrl(data.shareUrl ?? null);
      setShareError(data.shareError ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  async function updatePrototype() {
    if (!html || !instruction.trim()) return;
    setLoading("prototype");
    setError(null);
    try {
      const res = await fetch("/api/prototype", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engine: "aws",
          mode: "update",
          instruction,
          currentHtml: html,
          provider: model.provider,
          modelId: model.modelId,
          projectId: id,
          projectName: name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "更新に失敗しました");
      setHtml(data.html ?? null);
      setShareUrl(data.shareUrl ?? null);
      setShareError(data.shareError ?? null);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  // 公開・引き継ぎ（GitHub / Vercel）。トークン未設定時は未連携で返る。
  async function publishHandoff() {
    setLoading("publish");
    setError(null);
    try {
      const res = await fetch(`/api/projects/${id}/publish`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "公開・引き継ぎに失敗しました");
      setPublish(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  // チャット結果: 分析を反映し、必要なら AWS で UI を作り直す
  async function applyOrchestrate(data: OrchestrateResponse) {
    const r = (data.results ?? {}) as Record<string, unknown>;
    const a = (r.actors as { actors?: ActorView[] })?.actors;
    const u = (r.usecases as { useCases?: UseCaseView[] })?.useCases;
    const o = (r.ooui as { objects?: OouiView[] })?.objects;
    const n = (r.navigation as { items?: NavView[] })?.items;
    if (a) setActors(a);
    if (u) setUseCases(u);
    if (o) setOoui(o);
    if (n) setNav(n);
    if (data.regeneratePrototype) {
      setEngine("aws");
      await generatePrototype({
        engine: "aws",
        actors: a ?? actors,
        useCases: u ?? useCases,
        ooui: o ?? ooui,
        nav: n ?? nav,
      });
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <GlobalHeader
        back={{ href: `/studio/${id}`, label: "分析に戻る" }}
        center={
          <span className="text-sm font-medium text-foreground">
            {name || "…"} / プロトタイプ
          </span>
        }
        right={<ModelSelector value={model} onChange={setModel} />}
      />

      <ResizablePanelGroup className="flex-1">
        {/* 左ペイン: 操作 */}
        <ResizablePanel
          defaultSize="30%"
          minSize="22%"
          maxSize="48%"
          className="space-y-4 overflow-auto p-4"
        >
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              ① まずアプリ内で高速プレビュー → ② 良ければ v0 で本格化
            </p>
            <Button
              onClick={() => {
                setEngine("aws");
                generatePrototype({ engine: "aws" });
              }}
              disabled={loading !== null}
              className="w-full"
              size="lg"
            >
              {loading === "prototype" && engine === "aws"
                ? "プレビュー生成中…"
                : html || demoUrl
                  ? "プレビューを再生成（アプリ内）"
                  : "① プレビューを生成（アプリ内・高速）"}
            </Button>
            {(html || demoUrl) && (
              <Button
                variant="outline"
                onClick={() => {
                  setEngine("v0");
                  generatePrototype({ engine: "v0" });
                }}
                disabled={loading !== null}
                className="w-full"
              >
                {loading === "prototype" && engine === "v0"
                  ? "v0 で生成中…"
                  : "② v0 で本格プロトタイプ化 →"}
              </Button>
            )}
          </div>

          {html && (
            <div className="flex gap-2">
              <Input
                placeholder="修正指示（例: サイドバーを青く）"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") updatePrototype();
                }}
                disabled={loading !== null}
              />
              <Button
                onClick={updatePrototype}
                disabled={loading !== null || !instruction.trim()}
              >
                {loading === "prototype" ? "更新中…" : "更新"}
              </Button>
            </div>
          )}

          {(shareUrl || shareError) && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              {shareUrl ? (
                <>
                  <p className="font-medium text-muted-foreground">共有URL</p>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-primary underline"
                  >
                    {shareUrl}
                  </a>
                  <p className="mt-1 text-xs text-muted-foreground">
                    CloudFront 配信開始まで数分かかる場合あり
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">
                  共有URL未発行（{shareError}）
                </p>
              )}
            </div>
          )}

          <div className="space-y-2 border-t pt-4">
            <Button
              onClick={publishHandoff}
              disabled={loading !== null}
              variant="outline"
              className="w-full"
            >
              {loading === "publish" ? "引き継ぎ中…" : "公開・引き継ぎ"}
            </Button>
            <p className="text-xs text-muted-foreground">
              GitHub リポジトリ作成と Vercel デプロイへ引き継ぎます。
            </p>

            {publish && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                {publish.status === "published" ? (
                  <p className="font-medium text-muted-foreground">
                    引き継ぎ完了
                  </p>
                ) : publish.status === "not-configured" ? (
                  <p className="font-medium text-amber-500">
                    未連携（トークン未設定）
                  </p>
                ) : (
                  <p className="font-medium text-destructive">引き継ぎ失敗</p>
                )}
                <p className="mt-1 text-muted-foreground">{publish.message}</p>
                {publish.githubRepoUrl && (
                  <a
                    href={publish.githubRepoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all text-primary underline"
                  >
                    GitHub: {publish.githubRepoUrl}
                  </a>
                )}
                {publish.deploymentUrl && (
                  <a
                    href={publish.deploymentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block break-all text-primary underline"
                  >
                    Vercel: {publish.deploymentUrl}
                  </a>
                )}
              </div>
            )}
          </div>

          {id && (
            <AiConsultPanel
              projectId={id}
              model={model}
              busy={loading !== null}
              onBusyChange={(b) => setLoading(b ? "chat" : null)}
              onResults={applyOrchestrate}
            />
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右ペイン: プレビュー */}
        <ResizablePanel
          defaultSize="70%"
          className="overflow-hidden bg-muted/40 p-3"
        >
          {demoUrl ? (
            <iframe
              src={demoUrl}
              className="h-full w-full rounded-md border bg-white"
              title="prototype preview"
            />
          ) : html ? (
            <iframe
              srcDoc={html}
              className="h-full w-full rounded-md border bg-white"
              title="prototype preview (aws)"
              sandbox="allow-scripts"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              左の「プロトタイプ生成」を押すと、ここにプレビューが表示されます
            </div>
          )}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
