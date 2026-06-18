"use client";

/**
 * 会話型チャット（AI SDK useChat）。
 * ユーザーと会話しながら、要望に応じてアシスタントが runAnalysis ツールを呼び、
 * サーバ側で工程を再実行・保存 → その結果(tool output)を onResults で親に渡して
 * Studio の状態に反映する。返信はストリーミング表示。
 */
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelSelection } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { StepKey } from "@/lib/studio-types";

export type OrchestrateResponse = {
  reply?: string;
  ranSteps?: string[];
  results?: Record<string, unknown>;
  regeneratePrototype?: boolean;
};

const STEP_LABEL: Record<StepKey, string> = {
  actors: "アクター",
  usecases: "ユースケース",
  ooui: "モデリング",
  journey: "ジャーニー",
  navigation: "ナビゲーション",
  wireframe: "ワイヤー",
  datamodel: "データ設計",
  backend: "バックエンド",
  scope: "スコープ",
  kpi: "KPI",
  brand: "ブランド",
};

function labelSteps(steps: unknown): string {
  if (!Array.isArray(steps)) return "";
  return steps
    .map((s) => STEP_LABEL[s as StepKey] ?? String(s))
    .join("・");
}

export function AiConsultPanel({
  projectId,
  model,
  busy,
  onBusyChange,
  onResults,
}: {
  projectId: string;
  model: ModelSelection;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onResults: (data: OrchestrateResponse) => void | Promise<void>;
}) {
  // 送信時の追加ボディ（projectId / モデル）を ref 経由で最新値にする
  const cfgRef = useRef({
    projectId,
    provider: model.provider,
    modelId: model.modelId,
  });
  cfgRef.current = {
    projectId,
    provider: model.provider,
    modelId: model.modelId,
  };

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => cfgRef.current,
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const [input, setInput] = useState("");
  const appliedRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // ツール実行結果(runAnalysis の output)を親に反映（1回だけ）
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts) {
        const p = part as {
          type: string;
          toolCallId?: string;
          state?: string;
          output?: OrchestrateResponse;
        };
        if (
          p.type === "tool-runAnalysis" &&
          p.output &&
          p.toolCallId &&
          !appliedRef.current.has(p.toolCallId)
        ) {
          appliedRef.current.add(p.toolCallId);
          void onResults(p.output);
        }
      }
    }
  }, [messages, onResults]);

  // ステータスを親に通知（入力欄の無効化など）
  useEffect(() => {
    onBusyChange(status === "submitted" || status === "streaming");
  }, [status, onBusyChange]);

  // 自動スクロール
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const pending = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || pending || busy) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <Card className="flex min-h-0 flex-1 flex-col gap-3 bg-muted/40 p-4">
      <div>
        <h2 className="text-sm font-semibold">💬 AIに相談</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          例:「ホット率が下がったのでダッシュボードの優先表示を変えたい」
        </p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-auto">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            {m.parts.map((part, i) => {
              const p = part as {
                type: string;
                text?: string;
                state?: string;
                input?: { steps?: unknown };
                output?: { ranSteps?: unknown };
              };
              if (p.type === "text" && p.text) {
                return (
                  <span
                    key={i}
                    className={`inline-block max-w-[90%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-foreground"
                    }`}
                  >
                    {p.text}
                  </span>
                );
              }
              if (p.type === "tool-runAnalysis") {
                const done = p.state === "output-available";
                const steps = done ? p.output?.ranSteps : p.input?.steps;
                return (
                  <div
                    key={i}
                    className="my-1 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    <span>{done ? "✅" : "⚙️"}</span>
                    <span>
                      {done ? "更新しました" : "分析を更新中…"}
                      {steps ? `（${labelSteps(steps)}）` : ""}
                    </span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === "submitted" && (
          <p className="text-left text-xs text-muted-foreground">考え中…</p>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="メッセージを入力（Enterで送信）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // IME 変換確定の Enter では送信しない（日本語入力対策）
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          disabled={busy}
        />
        {pending ? (
          <Button variant="outline" onClick={() => stop()}>
            停止
          </Button>
        ) : (
          <Button onClick={submit} disabled={busy || !input.trim()}>
            送信
          </Button>
        )}
      </div>
    </Card>
  );
}
