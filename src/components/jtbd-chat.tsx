"use client";

/**
 * ジョブ理論モードの要望ヒアリング・チャット（AI SDK useChat → /api/jtbd）。
 * 対話で要望を深掘りし、まとまると saveRequirement ツールでプロジェクトに反映する。
 */
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import type { ModelSelection } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function JtbdChat({
  projectId,
  model,
  onSaved,
}: {
  projectId: string;
  model: ModelSelection;
  onSaved?: () => void;
}) {
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
        api: "/api/jtbd",
        body: () => cfgRef.current,
      }),
    [],
  );

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport,
  });
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState(false);
  const savedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 保存済み履歴があれば復元、無ければ AI からヒアリングを開始
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !projectId) return;
    startedRef.current = true;
    (async () => {
      const res = await fetch(
        `/api/chat/history?projectId=${projectId}&scope=jtbd`,
      );
      if (res.ok) {
        const d = await res.json();
        if (Array.isArray(d.messages) && d.messages.length) {
          setMessages(d.messages);
          return; // 履歴があれば自動開始しない
        }
      }
      void sendMessage({
        text: "プロダクトの要望をジョブ理論で深掘りしたいです。最初の質問をお願いします。",
      });
    })();
  }, [projectId, sendMessage, setMessages]);

  // saveRequirement ツールの成功を検出
  useEffect(() => {
    for (const m of messages) {
      if (m.role !== "assistant") continue;
      for (const part of m.parts) {
        const p = part as { type: string; output?: { saved?: boolean } };
        if (p.type === "tool-saveRequirement" && p.output?.saved) {
          if (!savedRef.current) {
            savedRef.current = true;
            setSaved(true);
            onSaved?.();
          }
        }
      }
    }
  }, [messages, onSaved]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const pending = status === "submitted" || status === "streaming";

  function submit() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    void sendMessage({ text });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-4"
      >
        {messages
          .filter((m, i) => !(i === 0 && m.role === "user")) // 起動用の最初の発話は隠す
          .map((m) => (
            <div
              key={m.id}
              className={m.role === "user" ? "text-right" : "text-left"}
            >
              {m.parts.map((part, i) => {
                const p = part as { type: string; text?: string };
                if (p.type === "text" && p.text) {
                  if (m.role === "user") {
                    return (
                      <span
                        key={i}
                        className="inline-block max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
                      >
                        {p.text}
                      </span>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className="inline-block max-w-[85%] rounded-lg bg-background px-3 py-2 text-left text-foreground"
                    >
                      <Markdown>{p.text}</Markdown>
                    </div>
                  );
                }
                if (p.type === "tool-saveRequirement") {
                  return (
                    <div
                      key={i}
                      className="my-1 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-muted-foreground"
                    >
                      ✅ 要望を入力資料に反映しました
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

      {saved && (
        <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-foreground">
          要望をプロジェクトに反映しました。分析に戻って実行できます。
        </div>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="回答を入力（Enterで送信）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
        />
        {pending ? (
          <Button variant="outline" onClick={() => stop()}>
            停止
          </Button>
        ) : (
          <Button onClick={submit} disabled={!input.trim()}>
            送信
          </Button>
        )}
      </div>
    </div>
  );
}
