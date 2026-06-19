"use client";

/**
 * プロトタイプ（Prototype シングルビュー）。左ペイン=操作、右ペイン=フルハイトプレビュー。
 * 分析データは /api/projects/[id] から取得して生成に使う。統合チャットからの
 * 自動再分析→UI再生成にも対応。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { extractHtmlFromText, postJson, streamPost } from "@/lib/api-client";
import {
  AiConsultPanel,
  type OrchestrateResponse,
} from "@/components/ai-consult-panel";
import { GlobalHeader } from "@/components/global-header";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import { AiGenerating } from "@/components/ai-generating";
import { LoadingOverlay } from "@/components/spinner";
import { Button, buttonVariants } from "@/components/ui/button";
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
  // チャット busy は loading とは別管理（共用すると生成 loading を上書きしてしまう）
  const [chatBusy, setChatBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);
  // ストリーミング生成の進捗（受信文字数）
  const [genChars, setGenChars] = useState(0);

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
        // 保存済みプレビュー/ホスティング結果を復元
        if (d.prototype) {
          setHtml(d.prototype.html ?? null);
          setDemoUrl(d.prototype.demoUrl ?? null);
          setShareUrl(d.prototype.demoUrl ?? null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "エラー");
      } finally {
        if (!cancelled) setLoadingProject(false);
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
    const payload = {
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
        attributes: (o.attributes ?? []).map((a) => a.label ?? a.name),
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
    };
    try {
      if (engineUsed === "aws") {
        // ストリーミング: 逐次トークンを受信し、進捗（文字数）を表示
        setGenChars(0);
        const raw = await streamPost("/api/prototype", payload, {
          onChunk: (acc) => setGenChars(acc.length),
        });
        setHtml(extractHtmlFromText(raw));
        setDemoUrl(null);
        setShareUrl(null);
        setShareError(null);
      } else {
        // v0 エンジンはホスティング込みで JSON を返す
        const data = await postJson<{
          demoUrl?: string | null;
          html?: string;
          shareUrl?: string;
          shareError?: string;
        }>("/api/prototype", payload);
        setDemoUrl(data.demoUrl ?? null);
        if (data.html !== undefined) setHtml(data.html);
        setShareUrl(data.shareUrl ?? data.demoUrl ?? null);
        setShareError(data.shareError ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
      setGenChars(0);
    }
  }

  // プレビューに納得したら共有URLを発行（AWS=S3/CloudFront でホスティング）
  async function hostPrototype() {
    if (!html) return;
    setLoading("host");
    setError(null);
    setShareError(null);
    try {
      const data = await postJson<{ shareUrl?: string }>("/api/prototype", {
        engine: "aws",
        mode: "host",
        currentHtml: html,
        projectId: id,
        projectName: name,
      });
      setShareUrl(data.shareUrl ?? null);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  async function updatePrototype() {
    if (!html || !instruction.trim()) return;
    setLoading("prototype");
    setError(null);
    try {
      setGenChars(0);
      const raw = await streamPost(
        "/api/prototype",
        {
          engine: "aws",
          mode: "update",
          instruction,
          currentHtml: html,
          provider: model.provider,
          modelId: model.modelId,
          projectId: id,
          projectName: name,
        },
        { onChunk: (acc) => setGenChars(acc.length) },
      );
      setHtml(extractHtmlFromText(raw));
      setShareUrl(null);
      setShareError(null);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
      setGenChars(0);
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
    <div className="relative flex h-screen flex-col">
      {loadingProject && <LoadingOverlay label="読み込み中…" />}
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
        {/* 左ペイン: AI相談チャットのみ */}
        <ResizablePanel
          defaultSize="30%"
          minSize="22%"
          maxSize="46%"
          className="flex flex-col gap-3 overflow-auto p-4"
        >
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {id && (
            <AiConsultPanel
              projectId={id}
              model={model}
              busy={loading !== null}
              onBusyChange={setChatBusy}
              onResults={applyOrchestrate}
            />
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* 右ペイン: アクションツールバー + プレビュー */}
        <ResizablePanel
          defaultSize="70%"
          className="flex flex-col overflow-hidden"
        >
          {/* アクションツールバー */}
          <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
            <Button
              size="sm"
              onClick={() => {
                setEngine("aws");
                generatePrototype({ engine: "aws" });
              }}
              disabled={loading !== null || chatBusy}
            >
              {loading === "prototype" && engine === "aws"
                ? "プレビュー生成中…"
                : html
                  ? "プレビュー再生成"
                  : "プレビューを生成"}
            </Button>

            {(html || demoUrl) && (
              <>
                <div className="flex items-center gap-1.5">
                  <Input
                    className="h-8 w-44"
                    placeholder="修正指示（例: サイドバーを青く）"
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    onKeyDown={(e) => {
                      // IME 変換確定の Enter では実行しない（日本語入力対策）
                      if (e.key === "Enter" && !e.nativeEvent.isComposing)
                        updatePrototype();
                    }}
                    disabled={loading !== null || chatBusy}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={updatePrototype}
                    disabled={loading !== null || chatBusy || !instruction.trim()}
                  >
                    {loading === "prototype" ? "更新中…" : "更新"}
                  </Button>
                </div>

                <span className="mx-1 h-5 w-px bg-border" />

                <Button
                  size="sm"
                  variant="outline"
                  onClick={hostPrototype}
                  disabled={loading !== null || chatBusy}
                >
                  {loading === "host" ? "ホスティング中…" : "ホスティング"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEngine("v0");
                    generatePrototype({ engine: "v0" });
                  }}
                  disabled={loading !== null || chatBusy}
                >
                  {loading === "prototype" && engine === "v0"
                    ? "v0生成中…"
                    : "v0で本格化"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={publishHandoff}
                  disabled={loading !== null || chatBusy}
                >
                  {loading === "publish" ? "引き継ぎ中…" : "公開・引き継ぎ"}
                </Button>

                <span className="mx-1 h-5 w-px bg-border" />

                <Link
                  href={`/studio/${id}/design-request`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  デザイナーに依頼 →
                </Link>
                <Link
                  href={`/studio/${id}/engineer-request`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  エンジニアに依頼 →
                </Link>
              </>
            )}
          </div>

          {/* 結果ストリップ（共有URL / 引き継ぎ） */}
          {(shareUrl || shareError || publish) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs">
              {shareUrl ? (
                <span>
                  共有URL:{" "}
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-primary underline"
                  >
                    {shareUrl}
                  </a>
                </span>
              ) : shareError ? (
                <span className="text-muted-foreground">
                  共有URL未発行（{shareError}）
                </span>
              ) : null}
              {publish && (
                <span
                  className={
                    publish.status === "published"
                      ? "text-muted-foreground"
                      : publish.status === "not-configured"
                        ? "text-amber-500"
                        : "text-destructive"
                  }
                >
                  {publish.status === "published"
                    ? "引き継ぎ完了"
                    : publish.status === "not-configured"
                      ? "未連携（トークン未設定）"
                      : "引き継ぎ失敗"}
                  {publish.githubRepoUrl && (
                    <>
                      {" · "}
                      <a
                        href={publish.githubRepoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        GitHub
                      </a>
                    </>
                  )}
                  {publish.deploymentUrl && (
                    <>
                      {" · "}
                      <a
                        href={publish.deploymentUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline"
                      >
                        Vercel
                      </a>
                    </>
                  )}
                </span>
              )}
            </div>
          )}

          {/* プレビュー */}
          <div className="relative flex-1 overflow-hidden bg-muted/40 p-3">
            {loading === "prototype" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm">
                <AiGenerating
                  label={engine === "v0" ? "本格プロトタイプ" : "プレビュー"}
                  messages={
                    engine === "v0"
                      ? [
                          "コンポーネントを設計しています",
                          "画面を組み立てています",
                          "スタイルを調整しています",
                          "仕上げています",
                        ]
                      : [
                          "ブランドを反映しています",
                          "画面を描いています",
                          "レイアウトを整えています",
                          "もうすぐ表示します",
                        ]
                  }
                />
                {engine === "aws" && genChars > 0 && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    生成中… {genChars.toLocaleString()} 文字
                  </p>
                )}
              </div>
            )}
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
                上の「プレビューを生成」を押すと、ここにプレビューが表示されます
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
