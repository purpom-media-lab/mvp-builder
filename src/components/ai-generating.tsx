"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** 生成中に順番に切り替わる“探索ログ”風メッセージ */
const QUEST_STEPS = [
  "情報を読み解いています",
  "最適な構造を探索しています",
  "アイデアを結びつけています",
  "細部を整えています",
  "もうすぐ到着します",
];

/**
 * AI 生成中の創造的ローダー。
 * 回転するコンパススイープ＋周回する星＋脈動オーラに、
 * 探索ログ風のメッセージがシマーしながら切り替わる。
 */
export function AiGenerating({
  label,
  messages = QUEST_STEPS,
  className,
}: {
  /** 生成対象（例: "スコープ"）。先頭の見出しに使う。 */
  label?: string;
  /** 切り替わるサブメッセージ */
  messages?: string[];
  className?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setI((p) => (p + 1) % messages.length),
      2200,
    );
    return () => clearInterval(t);
  }, [messages.length]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pm-sky flex items-center gap-4 overflow-hidden rounded-xl border bg-card/60 px-4 py-4",
        className,
      )}
    >
      <Compass />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          AIが{label ? `${label}を` : ""}生成しています
        </p>
        {/* key で再マウントして入場アニメを毎回再生 */}
        <p
          key={i}
          className="ai-gen-msg ai-gen-msg-enter mt-0.5 truncate text-[13px] font-medium"
        >
          {messages[i]}…
        </p>
      </div>
    </div>
  );
}

/** コンパス＋周回する星のアニメーション本体 */
function Compass() {
  return (
    <div className="ai-gen-compass" aria-hidden>
      <span className="ai-gen-aura" />
      <span className="ai-gen-track" />
      <span className="ai-gen-sweep" />
      <span className="ai-gen-core" />
      <span className="ai-gen-orbit">
        <span className="ai-gen-star" />
      </span>
      <span className="ai-gen-orbit ai-gen-orbit-2">
        <span className="ai-gen-star ai-gen-star-sm" />
      </span>
    </div>
  );
}
