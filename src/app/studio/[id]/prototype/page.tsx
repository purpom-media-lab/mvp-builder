"use client";

/**
 * プロトタイプ（Prototype シングルビュー）。左ペイン=操作、右ペイン=フルハイトプレビュー。
 * 分析データは /api/projects/[id] から取得して生成に使う。統合チャットからの
 * 自動再分析→UI再生成にも対応。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { postJson } from "@/lib/api-client";
import { fetchActiveJobs, type JobView, pollJob, startJob } from "@/lib/use-job";
import {
  AiConsultPanel,
  type OrchestrateResponse,
} from "@/components/ai-consult-panel";
import { GlobalHeader } from "@/components/global-header";
import type { ModelSelection } from "@/components/model-selector";
import { ModelPrefsDialog } from "@/components/model-prefs-dialog";
import {
  getModelForStep,
  loadBaseModel,
  loadModelPrefs,
  type ModelPrefs,
  recordUsage,
} from "@/lib/model-prefs";
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
  const [modelPrefs, setModelPrefs] = useState<ModelPrefs>({});
  const [prefsOpen, setPrefsOpen] = useState(false);

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
  // 本実装(realize)後は /run を直接プレビュー（SDK注入・実オリジンでLQ.dbが動く）。
  // srcDoc プレビューには SDK が無いため、本実装版はそこで保存するとエラーになる。
  const [livePreview, setLivePreview] = useState(false);
  const [runNonce, setRunNonce] = useState(0);

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
          const savedHtml = d.prototype.html ?? null;
          setHtml(savedHtml);
          setDemoUrl(d.prototype.demoUrl ?? null);
          setShareUrl(d.prototype.demoUrl ?? null);
          // 本実装版（LQ SDK を使うHTML）なら /run でライブ表示する
          if (savedHtml && /window\.LQ|LQ\.db|LQ\.auth/.test(savedHtml)) {
            setLivePreview(true);
          }
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

  // 基準モデルと工程ごとのモデル設定を localStorage から復元
  useEffect(() => {
    if (!id) return;
    setModel(loadBaseModel(id));
    setModelPrefs(loadModelPrefs(id));
  }, [id]);

  // ジョブ購読（ポーリング）の中断用。アンマウントで abort する。
  // 生成本体はサーバ側 after() で継続するので、画面遷移しても止まらない。
  const pollCtl = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    pollCtl.current = ctl;
    return () => ctl.abort();
  }, []);

  // 進行中のプロトタイプ生成ジョブを復帰する。別画面で開始・リロード前の生成が
  // まだ走っていれば、この画面でも進捗（文字数）を拾い直して最終 HTML を反映する。
  useEffect(() => {
    if (!id) return;
    const signal = pollCtl.current?.signal;
    let cancelled = false;
    (async () => {
      const active = await fetchActiveJobs(id);
      if (cancelled) return;
      const job = active.find((j) => j.kind === "prototype");
      if (!job) return;
      const loadingKey = job.step === "realize" ? "realize" : "prototype";
      setLoading(loadingKey);
      setGenChars(jobChars(job));
      pollJob(job.id, { signal, onProgress: (j) => setGenChars(jobChars(j)) })
        .then((final) => {
          if (final.status === "done") {
            const out = (final.result as { html?: string })?.html ?? "";
            if (out) setHtml(out);
            if (job.step === "realize" && out) {
              setLivePreview(true);
              setRunNonce((n) => n + 1);
            }
          } else if (final.status === "error") {
            setError(final.error ?? "生成に失敗しました");
          }
        })
        .catch(() => {})
        .finally(() => {
          setLoading((l) => (l === loadingKey ? null : l));
          setGenChars(0);
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ジョブ進捗から受信文字数を取り出す。
  function jobChars(job: JobView): number {
    return Number((job.progress as { chars?: number }).chars ?? 0);
  }

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
    const protoModel = getModelForStep(modelPrefs, "prototype", model);
    // 利用ログ計測（best-effort）
    const t0 = performance.now();
    let ok = false;
    const payload = {
      engine: engineUsed,
      provider: protoModel.provider,
      modelId: protoModel.modelId,
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
        // ジョブ起動 → ポーリングで進捗（文字数）を表示。生成はサーバ側 after() で
        // 走るので、待っている間に画面を離れても止まらない（保存もランナーが行う）。
        setGenChars(0);
        const job = await startJob({
          ...payload,
          kind: "prototype",
          mode: "create",
        });
        const final = await pollJob(job.id, {
          signal: pollCtl.current?.signal,
          onProgress: (j) => setGenChars(jobChars(j)),
        });
        if (final.status === "error")
          throw new Error(final.error ?? "生成に失敗しました");
        const finalHtml = (final.result as { html?: string })?.html ?? "";
        setHtml(finalHtml);
        setLivePreview(false);
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
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "prototype",
        provider: protoModel.provider,
        modelId: protoModel.modelId,
        ms: performance.now() - t0,
        ok,
      });
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
      const job = await startJob({
        projectId: id,
        kind: "prototype",
        engine: "aws",
        mode: "update",
        instruction,
        currentHtml: html,
        provider: getModelForStep(modelPrefs, "prototype", model).provider,
        modelId: getModelForStep(modelPrefs, "prototype", model).modelId,
        projectName: name,
      });
      const final = await pollJob(job.id, {
        signal: pollCtl.current?.signal,
        onProgress: (j) => setGenChars(jobChars(j)),
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const finalHtml = (final.result as { html?: string })?.html ?? "";
      setHtml(finalHtml);
      setShareUrl(null);
      setShareError(null);
      setInstruction("");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
      setGenChars(0);
    }
  }

  // 本実装: プレビューHTMLを LQ SDK で実データ保存・一覧する版に書き換える（ストリーミング）。
  async function realizePrototype() {
    if (!html) return;
    setLoading("realize");
    setError(null);
    const realizeModel = getModelForStep(modelPrefs, "prototype", model);
    const t0 = performance.now();
    let ok = false;
    try {
      setGenChars(0);
      const job = await startJob({
        projectId: id,
        kind: "prototype",
        engine: "aws",
        mode: "realize",
        currentHtml: html,
        provider: realizeModel.provider,
        modelId: realizeModel.modelId,
        projectName: name,
      });
      const final = await pollJob(job.id, {
        signal: pollCtl.current?.signal,
        onProgress: (j) => setGenChars(jobChars(j)),
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const finalHtml = (final.result as { html?: string })?.html ?? "";
      setHtml(finalHtml);
      setShareUrl(null);
      setShareError(null);
      // 本実装版は /run で表示（SDK注入・実オリジンでデータ保存が動く）
      setLivePreview(true);
      setRunNonce((n) => n + 1);
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "prototype",
        provider: realizeModel.provider,
        modelId: realizeModel.modelId,
        ms: performance.now() - t0,
        ok,
      });
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
        right={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPrefsOpen(true)}
            title="基準モデルと工程ごとのモデル（速い/賢い）を設定します"
          >
            ⚙️ モデル設定
          </Button>
        }
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

                <span className="mx-1 h-5 w-px bg-border" />

                {/* 本実装: プレビューを実データ保存できる動くMVPに変換する */}
                {html && (
                  <Button
                    size="sm"
                    onClick={realizePrototype}
                    disabled={loading !== null || chatBusy}
                  >
                    {loading === "realize"
                      ? "本実装生成中…"
                      : "本実装（データ保存を有効化）"}
                  </Button>
                )}
                {html && (
                  <a
                    href={`/run/${id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    公開URLを開く ↗
                  </a>
                )}
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
            {(loading === "prototype" || loading === "realize") && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm">
                <AiGenerating
                  label={
                    loading === "realize"
                      ? "本実装"
                      : engine === "v0"
                        ? "本格プロトタイプ"
                        : "プレビュー"
                  }
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
                {(engine === "aws" || loading === "realize") &&
                  genChars > 0 && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    生成中… {genChars.toLocaleString()} 文字
                  </p>
                )}
              </div>
            )}
            {livePreview && html && !demoUrl && loading !== "realize" && (
              <div className="pointer-events-none absolute right-5 top-5 z-10 rounded-full bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
                本実装プレビュー（データ保存が有効）
              </div>
            )}
            {demoUrl ? (
              <iframe
                src={demoUrl}
                className="h-full w-full rounded-md border bg-white"
                title="prototype preview"
              />
            ) : livePreview && html ? (
              // 本実装版は /run で表示（SDK注入・実オリジンで LQ.db 等の保存が動く）。
              // runNonce を key にして realize 完了ごとに最新HTMLを再取得する。
              <iframe
                key={runNonce}
                src={`/run/${id}`}
                className="h-full w-full rounded-md border bg-white"
                title="prototype preview (live)"
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
      {id && (
        <ModelPrefsDialog
          open={prefsOpen}
          onClose={() => setPrefsOpen(false)}
          projectId={id}
          baseModel={model}
          prefs={modelPrefs}
          onSave={setModelPrefs}
          onSaveBase={setModel}
        />
      )}
    </div>
  );
}
