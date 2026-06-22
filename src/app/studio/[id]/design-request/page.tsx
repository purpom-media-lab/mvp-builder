"use client";

/**
 * デザイナー連携（リファイン依頼）。
 * 3段の流れ:
 *  1) AIで依頼項目（デザインブリーフ）を下書き → フォームで編集
 *  2) 依頼を作成: ブリーフ(Markdown)をコピー/ダウンロード（＋DB保存 status=requested）
 *  3) 成果物（Figma URL / PDF）を指定してプロトタイプをブラッシュアップ（リファイン）
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { postJsonKeepalive } from "@/lib/api-client";
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
import { LoadingOverlay, Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
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
      const data = await postJsonKeepalive<{ brief: Partial<DesignBrief> }>(
        "/api/design-request/generate",
        {
          projectId: id,
          provider: reqModel.provider,
          modelId: reqModel.modelId,
        },
      );
      setBrief({ ...EMPTY_BRIEF, ...data.brief });
      ok = true;
    } catch (e) {
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
      const data = await postJsonKeepalive<{
        html?: string | null;
        demoUrl?: string | null;
      }>("/api/design-request/refine", {
        projectId: id,
        engine: "aws",
        provider: refineModel.provider,
        modelId: refineModel.modelId,
        figmaUrl: figmaUrl.trim() || undefined,
        pdfName: pdfName.trim() || undefined,
        pdfData: pdfData ?? undefined,
        note: note || undefined,
      });
      setRefinedHtml(data.html ?? null);
      setRefinedDemoUrl(data.demoUrl ?? null);
      setStatus("received");
      ok = true;
    } catch (e) {
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
    <div className="relative flex min-h-screen flex-col">
      {loadingProject && <LoadingOverlay label="読み込み中…" />}
      <GlobalHeader
        back={{ href: `/studio/${id}/prototype`, label: "プロトタイプに戻る" }}
        center={
          <span className="text-sm font-medium text-foreground">
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
      />

      <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* ステップ1: AIで依頼項目を生成 + 編集 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-base font-bold">
                1. リファイン依頼の項目
              </h2>
              <p className="text-xs text-muted-foreground">
                プロトタイプと分析結果から、デザイナーに渡す依頼項目をAIが下書きします。編集できます。
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
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

          <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
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
            <p className="text-xs text-muted-foreground">
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
          <details className="rounded-lg border border-border bg-muted/30 p-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              ブリーフのプレビュー（Markdown）
            </summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-foreground">
              {briefToMarkdown(brief)}
            </pre>
          </details>

          {/* メールでデザイナーに送信 */}
          <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
            <div>
              <h3 className="text-sm font-semibold">メールで依頼を送信</h3>
              <p className="text-xs text-muted-foreground">
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
            <p className="text-xs text-muted-foreground">
              デザイナーが作った Figma URL もしくは PDF を指定すると、それを参照してプロトタイプを作り直します。
            </p>
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
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
            <div className="text-center text-xs text-muted-foreground">
              または
            </div>
            <Field label="PDF をアップロード">
              <input
                type="file"
                accept="application/pdf"
                onChange={onPdfChange}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:text-foreground hover:file:bg-muted"
              />
              {pdfName && (
                <p className="mt-1 text-xs text-muted-foreground">
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
            <div className="space-y-2 rounded-lg border border-border bg-card/40 p-4">
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
        </section>
      </main>
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
