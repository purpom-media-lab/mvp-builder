"use client";

/**
 * デザイナー連携（リファイン依頼）。
 * 3段の流れ:
 *  1) AIで依頼項目（デザインブリーフ）を下書き → フォームで編集
 *  2) 依頼を作成: ブリーフ(Markdown)をコピー/ダウンロード（＋DB保存 status=requested）
 *  3) 成果物（Figma URL / PDF）を指定してプロトタイプをブラッシュアップ（リファイン）
 */
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { fetchActiveJobs, pollJob, startJob } from "@/lib/use-job";
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
import { LoadingOverlay, Spinner } from "@/components/spinner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface DesignBrief {
  productName: string;
  overview: string;
  objective: string;
  targetUsers: string;
  scopeScreens: string;
  brand: string;
  references: string;
  constraints: string;
  emphasis: string;
  deliverable: "figma" | "pdf";
  deadline: string;
}

const EMPTY_BRIEF: DesignBrief = {
  productName: "",
  overview: "",
  objective: "",
  targetUsers: "",
  scopeScreens: "",
  brand: "",
  references: "",
  constraints: "",
  emphasis: "",
  deliverable: "figma",
  deadline: "",
};

/** ブリーフ → デザイナーに渡す Markdown */
function briefToMarkdown(b: DesignBrief): string {
  const labelOf = b.deliverable === "figma" ? "Figma データ" : "PDF";
  return [
    `# デザインリファイン依頼: ${b.productName || "（プロダクト名未設定）"}`,
    ``,
    `## プロダクト概要`,
    b.overview || "—",
    ``,
    `## リファインの目的`,
    b.objective || "—",
    ``,
    `## ターゲット / ペルソナ`,
    b.targetUsers || "—",
    ``,
    `## 対象画面・スコープ`,
    b.scopeScreens || "—",
    ``,
    `## ブランド（配色・トーンマナー・ロゴ方向）`,
    b.brand || "—",
    ``,
    `## 参考デザイン・トンマナ参照`,
    b.references || "—",
    ``,
    `## 制約（アクセシビリティ / ブランドガイド / 技術）`,
    b.constraints || "—",
    ``,
    `## 重視点・改善要望`,
    b.emphasis || "—",
    ``,
    `## 成果物形式`,
    `- ${labelOf}`,
    ``,
    `## 納期`,
    b.deadline || "未定",
    ``,
  ].join("\n");
}

/** ファイル → data URL（base64） */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function DesignRequestPage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });
  const [modelPrefs, setModelPrefs] = useState<ModelPrefs>({});
  const [prefsOpen, setPrefsOpen] = useState(false);

  const [name, setName] = useState("");
  const [brief, setBrief] = useState<DesignBrief>(EMPTY_BRIEF);
  const [status, setStatus] = useState<"draft" | "requested" | "received">(
    "draft",
  );

  // 成果物指定
  const [figmaUrl, setFigmaUrl] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [pdfData, setPdfData] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // リファイン結果
  const [refinedHtml, setRefinedHtml] = useState<string | null>(null);
  const [refinedDemoUrl, setRefinedDemoUrl] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  // メール送信
  const [designerEmail, setDesignerEmail] = useState("");
  const [sendResult, setSendResult] = useState<
    { sent: boolean; reason?: string } | null
  >(null);

  // 初期ロード: プロジェクト名 + 既存のリファイン依頼
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [projRes, drRes] = await Promise.all([
          fetch(`/api/projects/${id}`),
          fetch(`/api/design-request?projectId=${id}`),
        ]);
        if (projRes.ok) {
          const d = await projRes.json();
          if (!cancelled) setName(d.project?.name ?? "");
        }
        if (drRes.ok) {
          const { designRequest } = await drRes.json();
          if (!cancelled && designRequest) {
            if (designRequest.brief)
              setBrief({ ...EMPTY_BRIEF, ...designRequest.brief });
            setStatus(designRequest.status ?? "draft");
            setFigmaUrl(designRequest.figmaUrl ?? "");
            setPdfName(designRequest.pdfName ?? "");
            setNote(designRequest.refinedNote ?? "");
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

  // ジョブ購読の中断用。生成はサーバ側 after() で継続するので画面遷移しても止まらない。
  const pollCtl = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    pollCtl.current = ctl;
    return () => ctl.abort();
  }, []);

  // 進行中のデザインブリーフ生成／成果物リファインジョブを復帰する。
  useEffect(() => {
    if (!id) return;
    const signal = pollCtl.current?.signal;
    let cancelled = false;
    (async () => {
      const active = await fetchActiveJobs(id);
      if (cancelled) return;
      const briefJob = active.find((j) => j.kind === "design-brief");
      if (briefJob) {
        setLoading("generate");
        pollJob(briefJob.id, { signal })
          .then((final) => {
            if (final.status === "done") {
              const b = (final.result as { brief?: Partial<DesignBrief> })
                ?.brief;
              if (b) setBrief({ ...EMPTY_BRIEF, ...b });
            } else if (final.status === "error") {
              setError(final.error ?? "生成に失敗しました");
            }
          })
          .catch(() => {})
          .finally(() => setLoading((l) => (l === "generate" ? null : l)));
      }
      const refineJob = active.find((j) => j.kind === "design-refine");
      if (refineJob) {
        setLoading("refine");
        pollJob(refineJob.id, { signal })
          .then((final) => {
            if (final.status === "done") {
              const r = final.result as {
                html?: string | null;
                demoUrl?: string | null;
              };
              setRefinedHtml(r?.html ?? null);
              setRefinedDemoUrl(r?.demoUrl ?? null);
              setStatus("received");
            } else if (final.status === "error") {
              setError(final.error ?? "生成に失敗しました");
            }
          })
          .catch(() => {})
          .finally(() => setLoading((l) => (l === "refine" ? null : l)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  function update<K extends keyof DesignBrief>(key: K, value: DesignBrief[K]) {
    setBrief((b) => ({ ...b, [key]: value }));
  }

  // 1) AIで依頼項目を生成
  async function generateBrief() {
    setLoading("generate");
    setError(null);
    const reqModel = getModelForStep(modelPrefs, "design-request", model);
    const t0 = performance.now();
    let ok = false;
    try {
      const job = await startJob({
        projectId: id,
        kind: "design-brief",
        provider: reqModel.provider,
        modelId: reqModel.modelId,
      });
      const final = await pollJob(job.id, { signal: pollCtl.current?.signal });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const b = (final.result as { brief?: Partial<DesignBrief> })?.brief;
      setBrief({ ...EMPTY_BRIEF, ...b });
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "design-request",
        provider: reqModel.provider,
        modelId: reqModel.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(null);
    }
  }

  // 保存（status 指定可）
  async function save(nextStatus?: "draft" | "requested" | "received") {
    const res = await fetch("/api/design-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: id,
        brief,
        status: nextStatus ?? status,
        figmaUrl: figmaUrl || null,
        pdfName: pdfName || null,
        pdfData,
        refinedNote: note || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "保存に失敗しました");
    }
    if (nextStatus) setStatus(nextStatus);
  }

  // 2) 依頼を作成（保存して status=requested）＋ コピー / ダウンロード
  async function createRequest() {
    setLoading("save");
    setError(null);
    try {
      await save("requested");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  // 2b) メールでデザイナーに依頼を送信
  async function sendByEmail() {
    const to = designerEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setError("有効なメールアドレスを入力してください");
      return;
    }
    setLoading("send");
    setError(null);
    setSendResult(null);
    try {
      const res = await fetch("/api/design-request/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: id, to, brief }),
      });
      const data = (await res.json()) as { sent?: boolean; reason?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "送信に失敗しました");
      setSendResult({ sent: !!data.sent, reason: data.reason });
      if (data.sent) setStatus("requested");
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(briefToMarkdown(brief));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("クリップボードへのコピーに失敗しました");
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([briefToMarkdown(brief)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `design-brief-${brief.productName || "request"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onPdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setPdfName(file.name);
      setPdfData(dataUrl);
      setFigmaUrl(""); // PDF を選んだら Figma 指定はクリア
    } catch {
      setError("PDF の読み込みに失敗しました");
    }
  }

  // 3) 成果物でブラッシュアップ
  async function refine() {
    if (!figmaUrl.trim() && !pdfName.trim()) {
      setError("Figma URL もしくは PDF を指定してください");
      return;
    }
    setLoading("refine");
    setError(null);
    setRefinedHtml(null);
    setRefinedDemoUrl(null);
    const refineModel = getModelForStep(modelPrefs, "design-request", model);
    const t0 = performance.now();
    let ok = false;
    try {
      const job = await startJob({
        projectId: id,
        kind: "design-refine",
        engine: "aws",
        provider: refineModel.provider,
        modelId: refineModel.modelId,
        figmaUrl: figmaUrl.trim() || undefined,
        pdfName: pdfName.trim() || undefined,
        pdfData: pdfData ?? undefined,
        note: note || undefined,
      });
      const final = await pollJob(job.id, { signal: pollCtl.current?.signal });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const data = final.result as {
        html?: string | null;
        demoUrl?: string | null;
      };
      setRefinedHtml(data?.html ?? null);
      setRefinedDemoUrl(data?.demoUrl ?? null);
      setStatus("received");
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "design-request",
        provider: refineModel.provider,
        modelId: refineModel.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(null);
    }
  }

  const statusLabel =
    status === "received"
      ? "成果物受領済み"
      : status === "requested"
        ? "依頼作成済み"
        : "下書き";

  return (
    <AppShell
      fullHeight
      back={{ href: `/studio/${id}/prototype`, label: "プロトタイプに戻る" }}
      center={
        <span className="text-sm font-medium text-base-content">
          {name || "…"} / デザイナーに依頼
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
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        {/* 依頼の進行状況（draft → requested → received）。各セクションの現在地を示す。 */}
        <div className="rounded-lg border border-base-300 bg-base-100/40 px-4 py-3">
          <StepIndicator
            current={
              status === "received" ? 3 : status === "requested" ? 2 : 1
            }
          />
        </div>

        {/* ステップ1: AIで依頼項目を生成 + 編集 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-bold">
                1. リファイン依頼の項目
              </h2>
              <p className="text-xs text-base-content/70">
                プロトタイプと分析結果から、デザイナーに渡す依頼項目をAIが下書きします。編集できます。
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-base-content/70">
              {statusLabel}
            </span>
          </div>

          <Button onClick={generateBrief} disabled={loading !== null}>
            {loading === "generate" ? (
              <>
                <Spinner className="h-3.5 w-3.5" />
                生成中…
              </>
            ) : (
              "AIで依頼項目を生成"
            )}
          </Button>

          <div className="space-y-4 rounded-lg border border-base-300 bg-base-100/40 p-4">
            <Field label="プロダクト名">
              <Input
                value={brief.productName}
                onChange={(e) => update("productName", e.target.value)}
              />
            </Field>
            <Field label="プロダクト概要">
              <Textarea
                value={brief.overview}
                onChange={(e) => update("overview", e.target.value)}
              />
            </Field>
            <Field label="リファインの目的">
              <Textarea
                value={brief.objective}
                onChange={(e) => update("objective", e.target.value)}
              />
            </Field>
            <Field label="ターゲット / ペルソナ">
              <Textarea
                value={brief.targetUsers}
                onChange={(e) => update("targetUsers", e.target.value)}
              />
            </Field>
            <Field label="対象画面・スコープ">
              <Textarea
                value={brief.scopeScreens}
                onChange={(e) => update("scopeScreens", e.target.value)}
              />
            </Field>
            <Field label="ブランド（配色HEX・トーンマナー・ロゴ方向）">
              <Textarea
                value={brief.brand}
                onChange={(e) => update("brand", e.target.value)}
              />
            </Field>
            <Field label="参考デザイン・トンマナ参照">
              <Textarea
                value={brief.references}
                onChange={(e) => update("references", e.target.value)}
              />
            </Field>
            <Field label="制約（アクセシビリティ / ブランドガイド / 技術）">
              <Textarea
                value={brief.constraints}
                onChange={(e) => update("constraints", e.target.value)}
              />
            </Field>
            <Field label="重視点・改善要望">
              <Textarea
                value={brief.emphasis}
                onChange={(e) => update("emphasis", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="成果物形式">
                <Select
                  value={brief.deliverable}
                  onValueChange={(v) =>
                    v && update("deliverable", v as "figma" | "pdf")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="figma">Figma データ</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="納期">
                <Input
                  value={brief.deadline}
                  onChange={(e) => update("deadline", e.target.value)}
                  placeholder="例: 2週間後 / 未定"
                />
              </Field>
            </div>
          </div>
        </section>

        {/* ステップ2: 依頼を作成（ブリーフ Markdown） */}
        <section className="space-y-3">
          <div>
            <h2 className="font-heading text-base font-bold">2. 依頼を作成</h2>
            <p className="text-xs text-base-content/70">
              依頼項目を保存し、デザイナーに渡すブリーフ（Markdown）をコピー / ダウンロードできます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={createRequest} disabled={loading !== null}>
              {loading === "save" ? "保存中…" : "依頼を作成（保存）"}
            </Button>
            <Button variant="outline" onClick={copyMarkdown}>
              {copied ? "コピーしました" : "ブリーフをコピー"}
            </Button>
            <Button variant="outline" onClick={downloadMarkdown}>
              Markdownをダウンロード
            </Button>
          </div>
          <details className="rounded-lg border border-base-300 bg-muted/30 p-3">
            <summary className="cursor-pointer text-xs text-base-content/70">
              ブリーフのプレビュー（Markdown）
            </summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-base-content">
              {briefToMarkdown(brief)}
            </pre>
          </details>

          {/* メールでデザイナーに送信 */}
          <div className="space-y-3 rounded-lg border border-base-300 bg-base-100/40 p-4">
            <div>
              <h3 className="text-sm font-semibold">メールで依頼を送信</h3>
              <p className="text-xs text-base-content/70">
                デザイナーのメールアドレスを入力すると、上のブリーフ（全文）をメールで送信します。
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                type="email"
                value={designerEmail}
                onChange={(e) => {
                  setDesignerEmail(e.target.value);
                  setSendResult(null);
                }}
                placeholder="designer@example.com"
                className="sm:flex-1"
              />
              <Button
                onClick={sendByEmail}
                disabled={loading !== null || !designerEmail.trim()}
                className="shrink-0"
              >
                {loading === "send" ? (
                  <>
                    <Spinner className="h-3.5 w-3.5" />
                    送信中…
                  </>
                ) : (
                  "メールで依頼を送信"
                )}
              </Button>
            </div>

            {sendResult?.sent && (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                {designerEmail.trim()} に依頼メールを送信しました。
              </div>
            )}
            {sendResult && !sendResult.sent && (
              <div className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
                {sendResult.reason === "not-configured" ? (
                  <>
                    メール送信が設定されていません。お手数ですが「ブリーフをコピー」または「Markdownをダウンロード」して、デザイナーへ直接共有してください。
                  </>
                ) : (
                  <>
                    送信に失敗しました（{sendResult.reason ?? "unknown"}）。コピー / ダウンロードでの共有をお試しください。
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ステップ3: 成果物でブラッシュアップ */}
        <section className="space-y-4">
          <div>
            <h2 className="font-heading text-base font-bold">
              3. 成果物でブラッシュアップ
            </h2>
            <p className="text-xs text-base-content/70">
              デザイナーが作った Figma URL もしくは PDF を指定すると、それを参照してプロトタイプを作り直します。
            </p>
          </div>

          <div className="space-y-4 rounded-lg border border-base-300 bg-base-100/40 p-4">
            <Field label="Figma URL">
              <Input
                value={figmaUrl}
                onChange={(e) => {
                  setFigmaUrl(e.target.value);
                  if (e.target.value) {
                    setPdfName("");
                    setPdfData(null);
                  }
                }}
                placeholder="https://www.figma.com/file/..."
              />
            </Field>
            <div className="text-center text-xs text-base-content/70">
              または
            </div>
            <Field label="PDF をアップロード">
              <input
                type="file"
                accept="application/pdf"
                onChange={onPdfChange}
                className="block w-full text-sm text-base-content/70 file:mr-3 file:rounded-md file:border file:border-base-300 file:bg-base-200 file:px-3 file:py-1.5 file:text-sm file:text-base-content hover:file:bg-muted"
              />
              {pdfName && (
                <p className="mt-1 text-xs text-base-content/70">
                  選択中: {pdfName}
                </p>
              )}
            </Field>
            <Field label="補足メモ（任意）">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="デザイナーの意図や特に反映したい点など"
              />
            </Field>

            <Button onClick={refine} disabled={loading !== null}>
              {loading === "refine" ? (
                <>
                  <Spinner className="h-3.5 w-3.5" />
                  ブラッシュアップ中…
                </>
              ) : (
                "このデザインでMVPをブラッシュアップ"
              )}
            </Button>
          </div>

          {(refinedHtml || refinedDemoUrl) && (
            <div className="space-y-2 rounded-lg border border-base-300 bg-base-100/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">リファイン結果</h3>
                <a
                  href={`/studio/${id}/prototype`}
                  className="text-xs text-primary underline underline-offset-2"
                >
                  プロトタイプ画面で開く →
                </a>
              </div>
              {refinedDemoUrl ? (
                <iframe
                  src={refinedDemoUrl}
                  className="h-[480px] w-full rounded-md border bg-white"
                  title="refined prototype"
                />
              ) : refinedHtml ? (
                <iframe
                  srcDoc={refinedHtml}
                  className="h-[480px] w-full rounded-md border bg-white"
                  title="refined prototype"
                  sandbox="allow-scripts"
                />
              ) : null}
            </div>
          )}

          {/* 成果物受領後は、公開・ビルドへ進む導線を出す（プロトタイプ画面へ戻る）。 */}
          {status === "received" && (
            <a
              href={`/studio/${id}/prototype`}
              className={buttonVariants({ size: "sm" })}
            >
              公開・ビルドへ進む →
            </a>
          )}
        </section>
      </div>
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-base-content">{label}</span>
      {children}
    </label>
  );
}

const REQUEST_STEPS = ["ブリーフ作成", "依頼確定", "成果物受領"] as const;

/** デザイン依頼の進行ステップ（draft=1 / requested=2 / received=3）を表示する。 */
function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
      {REQUEST_STEPS.map((label, i) => {
        const n = i + 1;
        const state =
          n < current ? "done" : n === current ? "current" : "upcoming";
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
                state === "current"
                  ? "bg-primary text-primary-content"
                  : state === "done"
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-base-content/70"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span
              className={
                state === "upcoming"
                  ? "text-base-content/70"
                  : "font-medium text-base-content"
              }
            >
              {label}
            </span>
            {i < REQUEST_STEPS.length - 1 && (
              <span className="mx-1 h-px w-6 bg-base-300" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
