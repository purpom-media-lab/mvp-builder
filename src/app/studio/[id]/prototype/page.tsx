"use client";

/**
 * プロトタイプ（Prototype シングルビュー）。左ペイン=操作、右ペイン=フルハイトプレビュー。
 * 分析データは /api/projects/[id] から取得して生成に使う。統合チャットからの
 * 自動再分析→UI再生成にも対応。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { postJson } from "@/lib/api-client";
import { parseScreenNames } from "@/lib/prototype-screens";
import { fetchActiveJobs, type JobView, pollJob, startJob } from "@/lib/use-job";
import {
  AiConsultPanel,
  type OrchestrateResponse,
} from "@/components/ai-consult-panel";
import { AppShell } from "@/components/app-shell";
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

/**
 * srcDoc プレビューに注入するブリッジ。親から postMessage({lqGoto: 画面名}) を受け、
 * (1) テキストが一致するナビ要素（a/button/tab 等）をクリックしてその画面へ遷移、
 * (2) 見つからなければ @screen マーカー直後の要素へスクロール、を試みる。
 * プロトタイプの遷移実装は任意JSなので確実ではない（ベストエフォート）。
 */
const SCREEN_JUMP_BRIDGE = `
<script>
(function () {
  function norm(s) { return (s || "").replace(/\\s+/g, "").toLowerCase(); }
  window.addEventListener("message", function (e) {
    var d = e && e.data;
    if (!d || d.lqGoto == null) return;
    var target = norm(String(d.lqGoto));
    if (!target) return;
    var nodes = document.querySelectorAll('a,button,[role="tab"],[role="menuitem"],[onclick],nav li,[data-screen]');
    var exact = null, partial = null;
    for (var i = 0; i < nodes.length; i++) {
      var t = norm(nodes[i].textContent);
      if (!t) continue;
      if (t === target) { exact = nodes[i]; break; }
      if (!partial && (t.indexOf(target) !== -1 || target.indexOf(t) !== -1)) partial = nodes[i];
    }
    var hit = exact || partial;
    if (hit) {
      try { hit.click(); } catch (_) {}
      try { hit.scrollIntoView({ block: "nearest" }); } catch (_) {}
      return;
    }
    var it = document.createNodeIterator(document.body, NodeFilter.SHOW_COMMENT);
    var c;
    while ((c = it.nextNode())) {
      if (norm(c.nodeValue).indexOf("@screen:" + target) !== -1) {
        var n = c.nextElementSibling || c.parentElement;
        if (n && n.scrollIntoView) { n.scrollIntoView({ block: "start" }); }
        return;
      }
    }
  });
})();
</script>`;

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
  // 生成対象に選んだ画面（ナビのラベル集合）。既定は全画面。空 or 全選択なら絞り込みなし。
  const [selectedScreens, setSelectedScreens] = useState<string[]>([]);
  const [scope, setScope] = useState<ScopeFeatureView[]>([]);
  const [mvpStatement, setMvpStatement] = useState("");
  const [kpi, setKpi] = useState<{
    northStar: KpiMetricView | null;
    supporting: KpiMetricView[];
  } | null>(null);
  const [brand, setBrand] = useState<BrandView | null>(null);

  const [engine, setEngine] = useState<"aws" | "ds">("ds");
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
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
  // 生成中に作れた画面名（@screen マーカーから抽出・出現順）。
  const [genScreens, setGenScreens] = useState<string[]>([]);
  // 直近の生成が出力上限で途中で切れたか（finishReason==="length"）。
  const [truncated, setTruncated] = useState(false);
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
        const navItems = (d.navigation ?? []) as NavView[];
        setNav(navItems);
        // 既定は全画面を生成対象に選択
        setSelectedScreens(navItems.map((n) => n.label));
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
          // 途中切れ検知: 完成HTMLは </html> で終わる。そうでなければ切り詰められている
          // （末尾の画面切替スクリプト等が欠落＝ナビが動かない）。リロード後も警告を出す。
          setTruncated(
            !!savedHtml && !/<\/html>\s*$/i.test(savedHtml.trim()),
          );
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

  // srcDoc プレビューの iframe（画面ジャンプの postMessage 送信先）。
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      applyGenProgress(job);
      pollJob(job.id, { signal, onProgress: applyGenProgress })
        .then((final) => {
          if (final.status === "done") {
            const r = final.result as { html?: string; truncated?: boolean };
            const out = r?.html ?? "";
            if (out) setHtml(out);
            setTruncated(Boolean(r?.truncated));
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

  // ジョブ進捗（文字数・生成できた画面名）をライブ表示に反映する。
  function applyGenProgress(job: JobView) {
    setGenChars(jobChars(job));
    const s = (job.progress as { screens?: unknown }).screens;
    if (Array.isArray(s)) setGenScreens(s as string[]);
  }

  // 生成対象の画面トグル。
  function toggleScreen(label: string) {
    setSelectedScreens((cur) =>
      cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
    );
  }

  // UC-更新2: 未生成だった画面を「追記型」で追加する。
  // 既存HTMLを保持したまま、選択中の画面を追加する更新（mode="update"）を実行する。
  async function appendScreens(labels: string[]) {
    if (!html || labels.length === 0) return;
    setLoading("prototype");
    setError(null);
    setGenChars(0);
    setGenScreens([]);
    const m = getModelForStep(modelPrefs, "prototype", model);
    const t0 = performance.now();
    let ok = false;
    try {
      const job = await startJob({
        projectId: id,
        kind: "prototype",
        engine: "aws",
        mode: "update",
        currentHtml: html,
        instruction: `既存の画面・構成・モックデータ・デザイン・画面遷移をすべて保持したまま、次の画面を新規に追加してください。ナビゲーションにも項目を加え、クリックで行き来できるようにすること（既存画面は変更・削除しない）: ${labels.join(", ")}`,
        provider: m.provider,
        modelId: m.modelId,
        projectName: name,
      });
      const final = await pollJob(job.id, {
        signal: pollCtl.current?.signal,
        onProgress: applyGenProgress,
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const r = final.result as { html?: string; truncated?: boolean };
      setHtml(r?.html ?? "");
      setTruncated(Boolean(r?.truncated));
      setShareUrl(null);
      setShareError(null);
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "prototype",
        provider: m.provider,
        modelId: m.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(null);
      setGenChars(0);
    }
  }

  async function generatePrototype(override?: {
    actors?: ActorView[];
    useCases?: UseCaseView[];
    ooui?: OouiView[];
    nav?: NavView[];
    engine?: "aws" | "ds";
  }) {
    const aData = override?.actors ?? actors;
    const ucData = override?.useCases ?? useCases;
    const oData = override?.ooui ?? ooui;
    // 画面選択による絞り込み（チャット再生成の override 時や全画面選択時は絞らない）。
    const useSelection =
      !override?.nav &&
      selectedScreens.length > 0 &&
      selectedScreens.length < nav.length;
    const baseNav = override?.nav ?? nav;
    const navData = useSelection
      ? baseNav.filter(
          (n) =>
            selectedScreens.includes(n.label) ||
            (n.parent != null && selectedScreens.includes(n.parent)),
        )
      : baseNav;
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
      // 部分生成のときだけ「この画面だけを過不足なく実装」と明示する。
      selectedScreens: useSelection ? selectedScreens : undefined,
      mvpStatement,
      // プロトタイプは探索用（broad）: includedInMvp で絞らず、全機能を網羅して渡す。
      scope: scope.map((f) => ({ name: f.name, description: f.description })),
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
      // ジョブ起動 → ポーリングで進捗（文字数・生成できた画面）を表示。生成はサーバ側
      // after() で走るので、待っている間に画面を離れても止まらない（保存もランナーが行う）。
      // engine="ds" は構造化生成（骨格コード＋画面別生成）。runner が engine で分岐する。
      setGenChars(0);
      setGenScreens([]);
      const job = await startJob({
        ...payload,
        kind: "prototype",
        mode: "create",
      });
      const final = await pollJob(job.id, {
        signal: pollCtl.current?.signal,
        onProgress: applyGenProgress,
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const r = final.result as { html?: string; truncated?: boolean };
      const finalHtml = r?.html ?? "";
      setHtml(finalHtml);
      setTruncated(Boolean(r?.truncated));
      setLivePreview(false);
      setDemoUrl(null);
      setShareUrl(null);
      setShareError(null);
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
  // 途中切れHTMLの続きを生成して連結する（従来エンジンの truncation 救済）。
  // まだ切れていれば再度押して継続できる。
  async function continuePrototype() {
    if (!html) return;
    setLoading("prototype");
    setError(null);
    setGenChars(0);
    setGenScreens([]);
    const m = getModelForStep(modelPrefs, "prototype", model);
    const t0 = performance.now();
    let ok = false;
    try {
      const job = await startJob({
        projectId: id,
        kind: "prototype",
        engine: "aws",
        mode: "continue",
        currentHtml: html,
        provider: m.provider,
        modelId: m.modelId,
        projectName: name,
      });
      const final = await pollJob(job.id, {
        signal: pollCtl.current?.signal,
        onProgress: applyGenProgress,
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const r = final.result as { html?: string; truncated?: boolean };
      setHtml(r?.html ?? "");
      setTruncated(Boolean(r?.truncated));
      setShareUrl(null);
      setShareError(null);
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "prototype",
        provider: m.provider,
        modelId: m.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(null);
      setGenChars(0);
    }
  }

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
      setGenScreens([]);
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
        onProgress: applyGenProgress,
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const r = final.result as { html?: string; truncated?: boolean };
      const finalHtml = r?.html ?? "";
      setHtml(finalHtml);
      setTruncated(Boolean(r?.truncated));
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
      setGenScreens([]);
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
        onProgress: applyGenProgress,
      });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const r = final.result as { html?: string; truncated?: boolean };
      const finalHtml = r?.html ?? "";
      setHtml(finalHtml);
      setTruncated(Boolean(r?.truncated));
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
      setEngine("ds");
      await generatePrototype({
        engine: "ds",
        actors: a ?? actors,
        useCases: u ?? useCases,
        ooui: o ?? ooui,
        nav: n ?? nav,
      });
    }
  }

  // 生成中はライブの画面リスト、それ以外は保存済み HTML から抽出した画面リストを表示。
  const generating = loading === "prototype" || loading === "realize";
  const savedScreens = useMemo(() => parseScreenNames(html), [html]);
  const screens = generating ? genScreens : savedScreens;

  // ナビ画面のうち「すでに生成済み」のラベル集合（保存HTMLの @screen と突き合わせ）。
  // ラベルが完全一致 or 部分一致するものを生成済みとみなす（モデルの命名揺れに対応）。
  const generatedSet = useMemo(() => {
    const set = new Set<string>();
    for (const n of nav) {
      if (
        savedScreens.some(
          (s) => s === n.label || s.includes(n.label) || n.label.includes(s),
        )
      ) {
        set.add(n.label);
      }
    }
    return set;
  }, [nav, savedScreens]);
  // 未生成の画面ラベル（UC-更新2 の追記対象候補）
  const missingScreens = nav
    .map((n) => n.label)
    .filter((l) => !generatedSet.has(l));

  // 画面ジャンプは srcDoc プレビュー（ローカルHTML）でのみ可能。demoUrl / /run はクロスオリジン。
  const canJump = !!html && !demoUrl && !livePreview;
  // srcDoc に「postMessage で指定画面へ遷移」するブリッジを注入する。
  const srcDocWithBridge = useMemo(
    () => (html ? html + SCREEN_JUMP_BRIDGE : html),
    [html],
  );

  // チップから iframe 内のブリッジに画面名を送り、該当画面へ遷移させる。
  function gotoScreen(label: string) {
    iframeRef.current?.contentWindow?.postMessage({ lqGoto: label }, "*");
  }

  return (
    <AppShell
      fullHeight
      back={{ href: `/studio/${id}`, label: "分析に戻る" }}
      center={
        <span className="text-sm font-medium text-base-content">
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
    >
      {loadingProject && <LoadingOverlay label="読み込み中…" />}
      <ResizablePanelGroup className="flex-1">
        {/* 左ペイン: AI相談チャットのみ */}
        <ResizablePanel
          defaultSize="30%"
          minSize="22%"
          maxSize="46%"
          className="flex flex-col gap-3 overflow-auto p-4"
        >
          {error && (
            <div className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
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
          <div className="flex flex-wrap items-center gap-2 border-b bg-base-200 px-3 py-2">
            {/* 主役: 構造化生成(DS)。骨格はコード製で崩れない。 */}
            <Button
              size="sm"
              onClick={() => {
                setEngine("ds");
                generatePrototype({ engine: "ds" });
              }}
              disabled={
                loading !== null ||
                chatBusy ||
                (nav.length > 0 && selectedScreens.length === 0)
              }
              title={
                nav.length > 0 && selectedScreens.length === 0
                  ? "生成する画面を1つ以上選択してください"
                  : "骨格をコードで固定し、画面ごとに生成して組み立てます（崩れにくい）"
              }
            >
              {loading === "prototype" && engine === "ds"
                ? "プレビュー生成中…"
                : html
                  ? "プレビュー再生成"
                  : "プレビューを生成"}
            </Button>

            {/* ⋯ メニュー: 従来方式（実験）への切替 */}
            <div className="relative">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEngineMenuOpen((o) => !o)}
                disabled={loading !== null || chatBusy}
                title="生成方式の切り替え"
                aria-label="生成方式メニュー"
              >
                ⋯
              </Button>
              {engineMenuOpen && (
                <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setEngineMenuOpen(false)}
                />
                <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-md border bg-base-200 p-1 shadow-md">
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-50"
                    disabled={
                      loading !== null ||
                      chatBusy ||
                      (nav.length > 0 && selectedScreens.length === 0)
                    }
                    onClick={() => {
                      setEngineMenuOpen(false);
                      setEngine("aws");
                      generatePrototype({ engine: "aws" });
                    }}
                  >
                    従来方式で生成（実験）
                    <span className="mt-0.5 block text-[10px] text-base-content/70">
                      単一HTMLを一括生成。途中で切れることがあります。
                    </span>
                  </button>
                </div>
                </>
              )}
            </div>

            {(html || demoUrl) && (
              // 微調整（UC-更新1）: 既存プレビューへの修正指示
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
            )}
          </div>

          {/* プレビュー完成後のアクション。OOUI 分析のワイヤー案に基づき
              「公開 / ビルド / デザイン依頼」の3グループに整理する。 */}
          {(html || demoUrl) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-base-200 px-3 py-2">
              {/* 公開 */}
              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                <span className="text-[11px] font-medium text-base-content/70">
                  公開
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={hostPrototype}
                  disabled={loading !== null || chatBusy}
                >
                  {loading === "host" ? "ホスティング中…" : "ホスティング"}
                </Button>
                {html && (
                  <a
                    href={`/run/${id}`}
                    target="_blank"
                    rel="noreferrer"
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    公開URLを開く ↗
                  </a>
                )}
              </div>

              {/* ビルド */}
              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                <span className="text-[11px] font-medium text-base-content/70">
                  ビルド
                </span>
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
                <span className="inline-flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={publishHandoff}
                    disabled={loading !== null || chatBusy}
                  >
                    {loading === "publish" ? "引き継ぎ中…" : "公開・引き継ぎ"}
                  </Button>
                  {publish?.status === "not-configured" && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      未連携
                    </span>
                  )}
                </span>
                <Link
                  href={`/studio/${id}/engineer-request`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  エンジニアに依頼 →
                </Link>
              </div>

              {/* デザイン依頼 */}
              <div className="flex items-center gap-1.5 rounded-md border px-2 py-1">
                <span className="text-[11px] font-medium text-base-content/70">
                  デザイン依頼
                </span>
                <Link
                  href={`/studio/${id}/design-request`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  デザイナーに依頼 →
                </Link>
              </div>
            </div>
          )}

          {/* 生成する画面の選択。出力量を抑えて途中切れを防ぎ、作りたい画面に集中する。
              全選択なら従来どおり全画面、絞ると「選んだ画面だけを過不足なく実装」する。 */}
          {!generating && nav.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium text-base-content/70">
                生成する画面（{selectedScreens.length}/{nav.length}）:
              </span>
              {nav.map((n, i) => {
                const on = selectedScreens.includes(n.label);
                const done = generatedSet.has(n.label);
                return (
                  <button
                    key={`${n.label}-${i}`}
                    type="button"
                    onClick={() => toggleScreen(n.label)}
                    title={done ? "生成済み" : "未生成"}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                      on
                        ? "border-primary bg-primary/10 text-base-content"
                        : "bg-base-200 text-base-content/70 opacity-60"
                    }`}
                  >
                    {n.parent ? `${n.parent} › ${n.label}` : n.label}
                    {/* 生成状況: 済（生成済み）/ 未（未生成） */}
                    <span
                      className={`rounded px-1 text-[9px] ${
                        done
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {done ? "済" : "未"}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSelectedScreens(nav.map((n) => n.label))}
                className="ml-1 text-base-content/70 underline"
              >
                全選択
              </button>
              <button
                type="button"
                onClick={() => setSelectedScreens([])}
                className="text-base-content/70 underline"
              >
                全解除
              </button>
              {/* 未生成だけ選択（UC-更新2 の起点）。生成済みがある時だけ意味を持つ。 */}
              {html && missingScreens.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedScreens(missingScreens)}
                  className="text-base-content/70 underline"
                >
                  未生成だけ選択（{missingScreens.length}）
                </button>
              )}
              {selectedScreens.length === 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  ※ 1つ以上選択してください
                </span>
              )}
              {/* 追記生成: 既存プレビューを保持したまま、選択画面を追加する（UC-更新2・追記型）。 */}
              {html && selectedScreens.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => appendScreens(selectedScreens)}
                  disabled={loading !== null || chatBusy}
                  title="既存プレビューを保持したまま、選択した画面を追加します（既存画面は作り直しません）"
                >
                  選択を既存に追記（{selectedScreens.length}）
                </Button>
              )}
            </div>
          )}

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
                <span className="text-base-content/70">
                  共有URL未発行（{shareError}）
                </span>
              ) : null}
              {publish && (
                <span
                  className={
                    publish.status === "published"
                      ? "text-base-content/70"
                      : publish.status === "not-configured"
                        ? "text-amber-500"
                        : "text-error"
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

          {/* 出力上限による途中切れの警告。無言の部分生成を防ぐ。 */}
          {!generating && truncated && html && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <span>
                生成が途中で切れています（HTML が未完で、ナビの <code>navigate()</code>{" "}
                等が欠落し遷移できないことがあります）。
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={continuePrototype}
                disabled={loading !== null || chatBusy}
                title="切れたHTMLの続きだけを生成して連結し、最後まで完成させます（足りなければ再度押せます）"
              >
                {loading === "prototype" ? "続きを生成中…" : "続きを生成"}
              </Button>
              <span>
                根本対策は <strong>「構造化生成(β)」</strong>（崩れない）か、
                画面を3〜4個に絞った分割生成です。
              </span>
            </div>
          )}

          {/* 生成された画面の一覧（@screen マーカーから抽出）。生成後にどんな画面が
              できたかを把握する。生成中はオーバーレイ側でライブ表示するため出さない。 */}
          {!generating && html && screens.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs">
              <span className="font-medium text-base-content/70">
                生成された画面 {screens.length}
                {canJump ? "（クリックで該当画面へ）" : ""}:
              </span>
              {screens.map((s) =>
                canJump ? (
                  <button
                    key={s}
                    type="button"
                    onClick={() => gotoScreen(s)}
                    title="プレビューを この画面へ移動"
                    className="rounded-full border bg-base-200 px-2.5 py-0.5 text-[11px] text-base-content transition hover:border-primary hover:bg-primary/10"
                  >
                    {s}
                  </button>
                ) : (
                  <span
                    key={s}
                    className="rounded-full border bg-base-200 px-2.5 py-0.5 text-[11px] text-base-content"
                  >
                    {s}
                  </span>
                ),
              )}
            </div>
          )}

          {/* プレビュー */}
          <div className="relative flex-1 overflow-hidden bg-muted/40 p-3">
            {(loading === "prototype" || loading === "realize") && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-base-200/70 backdrop-blur-sm">
                <AiGenerating
                  label={loading === "realize" ? "本実装" : "プレビュー"}
                  messages={[
                    "ブランドを反映しています",
                    "画面を描いています",
                    "レイアウトを整えています",
                    "もうすぐ表示します",
                  ]}
                />
                {(engine === "aws" || loading === "realize") &&
                  genChars > 0 && (
                  <p className="text-xs tabular-nums text-base-content/70">
                    生成中… {genChars.toLocaleString()} 文字
                  </p>
                )}
                {(engine === "aws" || loading === "realize") &&
                  genScreens.length > 0 && (
                  <div className="max-w-sm text-center">
                    <p className="mb-1.5 text-xs font-medium text-base-content/70">
                      生成できた画面 {genScreens.length}
                    </p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {genScreens.map((s) => (
                        <span
                          key={s}
                          className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] text-base-content"
                        >
                          ✓ {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {livePreview && html && !demoUrl && loading !== "realize" && (
              <div className="pointer-events-none absolute right-5 top-5 z-10 rounded-full bg-base-200/80 px-2.5 py-1 text-[11px] text-base-content/70 shadow-sm backdrop-blur">
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
                ref={iframeRef}
                srcDoc={srcDocWithBridge ?? undefined}
                className="h-full w-full rounded-md border bg-white"
                title="prototype preview (aws)"
                sandbox="allow-scripts"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-base-content/70">
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
    </AppShell>
  );
}
