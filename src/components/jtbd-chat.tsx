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
import { Textarea } from "@/components/ui/textarea";

/**
 * JTBD ヒアリングを自動開始するための最初の発話（UI では非表示）。
 * 復元時の「正規スレッド判定」にも使うため定数化している。
 */
const JTBD_SEED =
  "プロダクトの要望をジョブ理論で深掘りしたいです。最初の質問をお願いします。";

/** UIMessage から最初の text パートを取り出す（判定用）。 */
function firstText(m: { parts?: unknown[] } | undefined) {
  const parts = (m?.parts ?? []) as { type: string; text?: string }[];
  return parts.find((p) => p.type === "text")?.text;
}

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

  // 保存済み履歴があれば復元、無ければ AI からヒアリングを開始。
  // ただし復元するのは「正規の JTBD スレッド」＝先頭が JTBD_SEED で始まるものだけ。
  // テスト発話など異物スレッド（先頭がシード以外）は復元せず自動開始し、
  // onFinish の洗い替え保存で正規スレッドへ自己修復する。
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
        const msgs: typeof messages = Array.isArray(d.messages)
          ? d.messages
          : [];
        const head = msgs[0];
        const isProperThread =
          msgs.length > 0 &&
          head?.role === "user" &&
          firstText(head) === JTBD_SEED;
        if (isProperThread) {
          setMessages(msgs);
          return; // 正規スレッドのみ復元（自動開始しない）
        }
      }
      void sendMessage({ text: JTBD_SEED });
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

  // 会話をクリアして JTBD ヒアリングを最初からやり直す。
  // onFinish の洗い替え保存で、保存済みスレッドも新しい内容に置き換わる。
  function restart() {
    if (pending) return;
    savedRef.current = false;
    setSaved(false);
    setMessages([]);
    void sendMessage({ text: JTBD_SEED });
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={restart}
          disabled={pending}
          title="これまでの会話を消して、ジョブ理論の質問を最初からやり直します"
        >
          🔄 最初からやり直す
        </Button>
      </div>
      <div
        ref={scrollRef}
        className="h-[55vh] min-h-[300px] space-y-3 overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-4"
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
                        className="inline-block max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-content"
                      >
                        {p.text}
                      </span>
                    );
                  }
                  return (
                    <div
                      key={i}
                      className="inline-block max-w-[85%] rounded-lg border border-base-300 bg-base-200 px-3 py-2 text-left text-base-content"
                    >
                      <Markdown>{p.text}</Markdown>
                    </div>
                  );
                }
                if (p.type === "tool-saveRequirement") {
                  return (
                    <div
                      key={i}
                      className="my-1 inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs text-base-content/70"
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
          <p className="text-left text-xs text-base-content/70">考え中…</p>
        )}
      </div>

      {saved && (
        <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-base-content">
          要望をプロジェクトに反映しました。分析に戻って実行できます。
        </div>
      )}

      <div className="flex gap-2">
        <Textarea
          rows={1}
          placeholder="回答を入力（Enterで送信 / Shift+Enterで改行）"
          className="max-h-40 min-h-9 resize-none py-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Shift+Enter は改行。単独 Enter で送信（IME 変換確定は除外）。
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
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
