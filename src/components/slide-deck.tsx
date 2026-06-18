"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SlideRenderer } from "@/components/slides/slide-renderer";
import { cn } from "@/lib/utils";
import type { DeckTheme, SlideData } from "@/lib/slides/types";

/** スライドデッキのビューア（前後送り・ページ番号・サムネ・キーボード操作） */
export function SlideDeck({
  slides,
  theme,
}: {
  slides: SlideData[];
  theme?: DeckTheme;
}) {
  const [i, setI] = useState(0);
  const total = slides.length;

  const go = useCallback(
    (n: number) => setI((cur) => Math.max(0, Math.min(total - 1, n ?? cur))),
    [total],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setI((c) => Math.min(total - 1, c + 1));
      if (e.key === "ArrowLeft") setI((c) => Math.max(0, c - 1));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [total]);

  if (!total) return null;
  const current = slides[Math.min(i, total - 1)];

  return (
    <div className="space-y-3">
      <div className="mx-auto w-full max-w-3xl">
        <SlideRenderer slide={current} theme={theme} />
      </div>

      <div className="flex items-center justify-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(i - 1)}
          disabled={i === 0}
        >
          ←
        </Button>
        <span className="text-sm text-muted-foreground tabular-nums">
          {i + 1} / {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => go(i + 1)}
          disabled={i === total - 1}
        >
          →
        </Button>
      </div>

      {current.notes && (
        <p className="mx-auto max-w-3xl rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          🎤 {current.notes}
        </p>
      )}

      {/* サムネイル */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {slides.map((s, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setI(idx)}
            aria-label={`スライド ${idx + 1}`}
            className={cn(
              "w-28 shrink-0 overflow-hidden rounded-md ring-2 transition-all",
              idx === i ? "ring-primary" : "ring-transparent hover:ring-border",
            )}
          >
            <div className="pointer-events-none">
              <SlideRenderer slide={s} theme={theme} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
