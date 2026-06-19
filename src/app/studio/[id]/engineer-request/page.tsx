"use client";

/**
 * エンジニア連携（開発依頼）。
 * 2段の流れ:
 *  1) AIで依頼項目（エンジニアブリーフ）を下書き → フォームで編集
 *  2) 依頼を作成: ブリーフ(Markdown)をコピー/ダウンロード（＋DB保存 status=requested）
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { postJsonKeepalive } from "@/lib/api-client";
import { GlobalHeader } from "@/components/global-header";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import {
  getModelForStep,
  loadModelPrefs,
  type ModelPrefs,
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

interface EngineerBrief {
  productName: string;
  overview: string;
  functionalRequirements: string;
  screens: string;
  dataModel: string;
  apiEndpoints: string;
  nonFunctional: string;
  suggestedStack: string;
  milestones: string;
  acceptanceCriteria: string;
  deliverable: "repo" | "spec";
  deadline: string;
}

const EMPTY_BRIEF: EngineerBrief = {
  productName: "",
  overview: "",
  functionalRequirements: "",
  screens: "",
  dataModel: "",
  apiEndpoints: "",
  nonFunctional: "",
  suggestedStack: "",
  milestones: "",
  acceptanceCriteria: "",
  deliverable: "repo",
  deadline: "",
};

/** ブリーフ → エンジニアに渡す Markdown */
function briefToMarkdown(b: EngineerBrief): string {
  const labelOf =
    b.deliverable === "repo" ? "動くコード / リポジトリ" : "開発仕様書";
  return [
    `# 開発依頼: ${b.productName || "（プロダクト名未設定）"}`,
    ``,
    `## 背景・目的`,
    b.overview || "—",
    ``,
    `## 機能要件`,
    b.functionalRequirements || "—",
    ``,
    `## 主要画面`,
    b.screens || "—",
    ``,
    `## データ設計（主要エンティティ・関係）`,
    b.dataModel || "—",
    ``,
    `## 主要API`,
    b.apiEndpoints || "—",
    ``,
    `## 非機能要件（認証/権限/性能/セキュリティ）`,
    b.nonFunctional || "—",
    ``,
    `## 推奨技術スタック`,
    b.suggestedStack || "—",
    ``,
    `## マイルストーン / フェーズ`,
    b.milestones || "—",
    ``,
    `## 受け入れ条件`,
    b.acceptanceCriteria || "—",
    ``,
    `## 成果物形式`,
    `- ${labelOf}`,
    ``,
    `## 納期`,
    b.deadline || "未定",
    ``,
  ].join("\n");
}

export default function EngineerRequestPage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });
  const [modelPrefs, setModelPrefs] = useState<ModelPrefs>({});

  const [name, setName] = useState("");
  const [brief, setBrief] = useState<EngineerBrief>(EMPTY_BRIEF);
  const [status, setStatus] = useState<"draft" | "requested">("draft");

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  // 初期ロード: プロジェクト名 + 既存の開発依頼
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const [projRes, erRes] = await Promise.all([
          fetch(`/api/projects/${id}`),
          fetch(`/api/engineer-request?projectId=${id}`),
        ]);
        if (projRes.ok) {
          const d = await projRes.json();
          if (!cancelled) setName(d.project?.name ?? "");
        }
        if (erRes.ok) {
          const { engineerRequest } = await erRes.json();
          if (!cancelled && engineerRequest) {
            if (engineerRequest.brief)
              setBrief({ ...EMPTY_BRIEF, ...engineerRequest.brief });
            setStatus(engineerRequest.status ?? "draft");
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

  // 工程ごとのモデル設定を localStorage から復元
  useEffect(() => {
    if (!id) return;
    setModelPrefs(loadModelPrefs(id));
  }, [id]);

  function update<K extends keyof EngineerBrief>(
    key: K,
    value: EngineerBrief[K],
  ) {
    setBrief((b) => ({ ...b, [key]: value }));
  }

  // 1) AIで依頼項目を生成
  async function generateBrief() {
    setLoading("generate");
    setError(null);
    const reqModel = getModelForStep(modelPrefs, "engineer-request", model);
    try {
      const data = await postJsonKeepalive<{ brief: Partial<EngineerBrief> }>(
        "/api/engineer-request/generate",
        {
          projectId: id,
          provider: reqModel.provider,
          modelId: reqModel.modelId,
        },
      );
      setBrief({ ...EMPTY_BRIEF, ...data.brief });
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      setLoading(null);
    }
  }

  // 保存（status 指定可）
  async function save(nextStatus?: "draft" | "requested") {
    const res = await fetch("/api/engineer-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: id,
        brief,
        status: nextStatus ?? status,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "保存に失敗しました");
    }
    if (nextStatus) setStatus(nextStatus);
  }

  // 2) 依頼を作成（保存して status=requested）
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
    a.download = `engineer-brief-${brief.productName || "request"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const statusLabel = status === "requested" ? "依頼作成済み" : "下書き";

  return (
    <div className="relative flex min-h-screen flex-col">
      {loadingProject && <LoadingOverlay label="読み込み中…" />}
      <GlobalHeader
        back={{ href: `/studio/${id}/prototype`, label: "プロトタイプに戻る" }}
        center={
          <span className="text-sm font-medium text-foreground">
            {name || "…"} / エンジニアに依頼
          </span>
        }
        right={<ModelSelector value={model} onChange={setModel} />}
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
                1. 開発依頼の項目
              </h2>
              <p className="text-xs text-muted-foreground">
                プロトタイプと分析・設計結果から、エンジニアに渡す開発依頼（開発仕様書/チケット）をAIが下書きします。編集できます。
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
              "AIで開発依頼を生成"
            )}
          </Button>

          <div className="space-y-4 rounded-lg border border-border bg-card/40 p-4">
            <Field label="プロダクト名">
              <Input
                value={brief.productName}
                onChange={(e) => update("productName", e.target.value)}
              />
            </Field>
            <Field label="背景・目的">
              <Textarea
                value={brief.overview}
                onChange={(e) => update("overview", e.target.value)}
              />
            </Field>
            <Field label="機能要件">
              <Textarea
                value={brief.functionalRequirements}
                onChange={(e) =>
                  update("functionalRequirements", e.target.value)
                }
              />
            </Field>
            <Field label="主要画面">
              <Textarea
                value={brief.screens}
                onChange={(e) => update("screens", e.target.value)}
              />
            </Field>
            <Field label="データ設計（主要エンティティ・関係）">
              <Textarea
                value={brief.dataModel}
                onChange={(e) => update("dataModel", e.target.value)}
              />
            </Field>
            <Field label="主要API">
              <Textarea
                value={brief.apiEndpoints}
                onChange={(e) => update("apiEndpoints", e.target.value)}
              />
            </Field>
            <Field label="非機能要件（認証/権限/性能/セキュリティ）">
              <Textarea
                value={brief.nonFunctional}
                onChange={(e) => update("nonFunctional", e.target.value)}
              />
            </Field>
            <Field label="推奨技術スタック">
              <Textarea
                value={brief.suggestedStack}
                onChange={(e) => update("suggestedStack", e.target.value)}
              />
            </Field>
            <Field label="マイルストーン / フェーズ">
              <Textarea
                value={brief.milestones}
                onChange={(e) => update("milestones", e.target.value)}
              />
            </Field>
            <Field label="受け入れ条件">
              <Textarea
                value={brief.acceptanceCriteria}
                onChange={(e) => update("acceptanceCriteria", e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="成果物形式">
                <Select
                  value={brief.deliverable}
                  onValueChange={(v) =>
                    v && update("deliverable", v as "repo" | "spec")
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="repo">動くコード / リポジトリ</SelectItem>
                    <SelectItem value="spec">開発仕様書</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="納期">
                <Input
                  value={brief.deadline}
                  onChange={(e) => update("deadline", e.target.value)}
                  placeholder="例: 1ヶ月後 / 未定"
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
              依頼項目を保存し、エンジニアに渡す開発依頼（Markdown）をコピー / ダウンロードできます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={createRequest} disabled={loading !== null}>
              {loading === "save" ? "保存中…" : "依頼を作成（保存）"}
            </Button>
            <Button variant="outline" onClick={copyMarkdown}>
              {copied ? "コピーしました" : "開発依頼をコピー"}
            </Button>
            <Button variant="outline" onClick={downloadMarkdown}>
              Markdownをダウンロード
            </Button>
          </div>
          <details className="rounded-lg border border-border bg-muted/30 p-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              開発依頼のプレビュー（Markdown）
            </summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-foreground">
              {briefToMarkdown(brief)}
            </pre>
          </details>
        </section>
      </main>
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
