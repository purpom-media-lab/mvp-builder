"use client";

/**
 * 提案資料（スライド）ページ。プロジェクトの分析結果から slideData を生成し、
 * アプリ内で HTML スライドとしてプレビュー。JSON は figma-slide-gen 互換で
 * コピー/ダウンロードできる。
 */
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { fetchActiveJobs, pollJob, startJob } from "@/lib/use-job";
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
import { SlideDeck } from "@/components/slide-deck";
import { AiGenerating } from "@/components/ai-generating";
import { PageLoading } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import type { DeckTheme, SlideData } from "@/lib/slides/types";

export default function DeckPage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });
  const [modelPrefs, setModelPrefs] = useState<ModelPrefs>({});
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [name, setName] = useState("");
  const [deck, setDeck] = useState<SlideData[] | null>(null);
  const [theme, setTheme] = useState<DeckTheme>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadingProject, setLoadingProject] = useState(true);

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
        setTheme({
          primary: d.brand?.palette?.primary,
          accent: d.brand?.palette?.accent,
        });
        if (Array.isArray(d.deck) && d.deck.length) {
          setDeck(d.deck as SlideData[]);
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

  // 進行中の提案資料生成ジョブを復帰する（別画面で開始・リロード前の生成の継続表示）。
  useEffect(() => {
    if (!id) return;
    const signal = pollCtl.current?.signal;
    let cancelled = false;
    (async () => {
      const active = await fetchActiveJobs(id);
      if (cancelled) return;
      const job = active.find((j) => j.kind === "deck");
      if (!job) return;
      setLoading(true);
      pollJob(job.id, { signal })
        .then((final) => {
          if (final.status === "done") {
            const d = (final.result as { deck?: SlideData[] })?.deck;
            if (Array.isArray(d)) setDeck(d);
          } else if (final.status === "error") {
            setError(final.error ?? "生成に失敗しました");
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function generate() {
    setLoading(true);
    setError(null);
    const deckModel = getModelForStep(modelPrefs, "deck", model);
    const t0 = performance.now();
    let ok = false;
    try {
      const job = await startJob({
        projectId: id,
        kind: "deck",
        provider: deckModel.provider,
        modelId: deckModel.modelId,
      });
      const final = await pollJob(job.id, { signal: pollCtl.current?.signal });
      if (final.status === "error")
        throw new Error(final.error ?? "生成に失敗しました");
      const d = (final.result as { deck?: SlideData[] })?.deck;
      if (Array.isArray(d)) setDeck(d);
      ok = true;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
      recordUsage(id, {
        step: "deck",
        provider: deckModel.provider,
        modelId: deckModel.modelId,
        ms: performance.now() - t0,
        ok,
      });
      setLoading(false);
    }
  }

  async function copyJson() {
    if (!deck) return;
    await navigator.clipboard.writeText(JSON.stringify(deck, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadJson() {
    if (!deck) return;
    const blob = new Blob([JSON.stringify(deck, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "slides"}-slideData.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-screen flex-col">
      <GlobalHeader
        back={{ href: `/studio/${id}`, label: "分析に戻る" }}
        center={
          <span className="text-sm font-medium text-base-content">
            {name || "…"} / 資料
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

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {error && (
            <div className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={generate} disabled={loading}>
              {loading
                ? "生成中…"
                : deck
                  ? "資料を再生成"
                  : "提案資料を生成"}
            </Button>
            {deck && (
              <>
                <Button variant="outline" onClick={copyJson}>
                  {copied ? "コピー済み" : "JSONをコピー"}
                </Button>
                <Button variant="outline" onClick={downloadJson}>
                  JSONをダウンロード
                </Button>
                <span className="text-xs text-base-content/70">
                  figma-slide-gen / gslide-data-gen に貼り付けて実スライド化できます
                </span>
              </>
            )}
          </div>

          {loadingProject ? (
            <PageLoading label="読み込み中…" />
          ) : loading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <AiGenerating
                label="提案資料"
                messages={[
                  "ストーリーを組み立てています",
                  "要点をスライドに落とし込んでいます",
                  "構成を整えています",
                  "仕上げています",
                ]}
              />
            </div>
          ) : deck ? (
            <SlideDeck slides={deck} theme={theme} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-sm text-base-content/70">
              「提案資料を生成」を押すと、分析結果からスライドを作成します
            </div>
          )}
        </div>
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
    </div>
  );
}
