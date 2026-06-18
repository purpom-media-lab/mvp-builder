"use client";

/**
 * 提案資料（スライド）ページ。プロジェクトの分析結果から slideData を生成し、
 * アプリ内で HTML スライドとしてプレビュー。JSON は figma-slide-gen 互換で
 * コピー/ダウンロードできる。
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { GlobalHeader } from "@/components/global-header";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import { SlideDeck } from "@/components/slide-deck";
import { Button } from "@/components/ui/button";
import type { DeckTheme, SlideData } from "@/lib/slides/types";

export default function DeckPage() {
  const { id } = useParams<{ id: string }>();

  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });
  const [name, setName] = useState("");
  const [deck, setDeck] = useState<SlideData[] | null>(null);
  const [theme, setTheme] = useState<DeckTheme>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: id,
          provider: model.provider,
          modelId: model.modelId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "資料生成に失敗しました");
      setDeck(data.deck as SlideData[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "エラー");
    } finally {
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
          <span className="text-sm font-medium text-foreground">
            {name || "…"} / 資料
          </span>
        }
        right={<ModelSelector value={model} onChange={setModel} />}
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
                <span className="text-xs text-muted-foreground">
                  figma-slide-gen / gslide-data-gen に貼り付けて実スライド化できます
                </span>
              </>
            )}
          </div>

          {deck ? (
            <SlideDeck slides={deck} theme={theme} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
              「提案資料を生成」を押すと、分析結果からスライドを作成します
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
