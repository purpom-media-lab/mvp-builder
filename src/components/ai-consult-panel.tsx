"use client";

/**
 * 統合チャット（要望→自動再分析→UI再提案）の共通コンポーネント。
 *
 * human-in-the-loop:
 *  1. 要望送信 → AI が「再実行すべき工程」を計画
 *  2. 承認制なら計画カードを提示 → ユーザーが承認 → 実行
 *     （自動モードなら即実行）
 *  3. 実行中は工程チェックリスト（進捗タイムライン）を表示
 * orchestrate のレスポンスは onResults で親に渡し、状態更新は親が行う。
 */
import { useState } from "react";
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

type Plan = {
  reply: string;
  plannedSteps: StepKey[];
  regeneratePrototype: boolean;
  message: string;
};

type LogItem =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string };

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
  const [log, setLog] = useState<LogItem[]>([]);
  const [input, setInput] = useState("");
  const [auto, setAuto] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState<{
    steps: StepKey[];
    doneCount: number;
  } | null>(null);

  function post(payload: Record<string, unknown>) {
    return fetch("/api/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        provider: model.provider,
        modelId: model.modelId,
        ...payload,
      }),
    });
  }

  async function execute(p: Plan) {
    setPlan(null);
    setRunning({ steps: p.plannedSteps, doneCount: 0 });
    onBusyChange(true);
    try {
      const res = await post({
        mode: "execute",
        message: p.message,
        steps: p.plannedSteps,
      });
      const data = (await res.json()) as OrchestrateResponse & {
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "実行に失敗しました");
      setRunning({ steps: p.plannedSteps, doneCount: p.plannedSteps.length });
      const ran = data.ranSteps ?? [];
      setLog((l) => [
        ...l,
        {
          role: "assistant",
          text: `完了しました${ran.length ? `（再分析: ${ran.map((s) => STEP_LABEL[s as StepKey] ?? s).join(", ")}）` : ""}`,
        },
      ]);
      await onResults({ ...data, regeneratePrototype: p.regeneratePrototype });
    } catch (e) {
      setLog((l) => [
        ...l,
        {
          role: "assistant",
          text: `エラー: ${e instanceof Error ? e.message : "失敗"}`,
        },
      ]);
    } finally {
      onBusyChange(false);
      setTimeout(() => setRunning(null), 1200);
    }
  }

  async function send() {
    if (!projectId || !input.trim() || busy) return;
    const msg = input.trim();
    setLog((l) => [...l, { role: "user", text: msg }]);
    setInput("");
    onBusyChange(true);
    try {
      const res = await post({ mode: "plan", message: msg });
      const data = (await res.json()) as {
        reply?: string;
        plannedSteps?: StepKey[];
        regeneratePrototype?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "失敗しました");
      const p: Plan = {
        reply: data.reply ?? "",
        plannedSteps: data.plannedSteps ?? [],
        regeneratePrototype: data.regeneratePrototype ?? false,
        message: msg,
      };
      setLog((l) => [...l, { role: "assistant", text: p.reply }]);
      onBusyChange(false);
      if (p.plannedSteps.length === 0 && !p.regeneratePrototype) return;
      if (auto) {
        await execute(p);
      } else {
        setPlan(p); // 承認待ち
      }
    } catch (e) {
      setLog((l) => [
        ...l,
        {
          role: "assistant",
          text: `エラー: ${e instanceof Error ? e.message : "失敗"}`,
        },
      ]);
      onBusyChange(false);
    }
  }

  return (
    <Card className="gap-3 bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            💬 AIに相談（要望から自動で再分析・UI再提案）
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            例:「ホット率が下がったのでダッシュボードの優先表示を変えたい」
          </p>
        </div>
        {/* 自律性トグル */}
        <button
          type="button"
          onClick={() => setAuto((a) => !a)}
          className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          title="承認制 ↔ 自動実行"
        >
          {auto ? "⚡ 自動実行" : "✋ 承認制"}
        </button>
      </div>

      {log.length > 0 && (
        <div className="max-h-48 space-y-2 overflow-auto">
          {log.map((m, i) => (
            <div
              key={i}
              className={`text-sm ${
                m.role === "user" ? "text-foreground" : "text-primary"
              }`}
            >
              <span className="font-semibold">
                {m.role === "user" ? "あなた: " : "AI: "}
              </span>
              {m.text}
            </div>
          ))}
        </div>
      )}

      {/* 計画カード（承認待ち） */}
      {plan && (
        <Card className="gap-2 border-primary/40 p-3">
          <p className="text-xs font-semibold text-muted-foreground">
            この計画で実行しますか？
          </p>
          <ul className="space-y-0.5 text-sm">
            {plan.plannedSteps.map((s) => (
              <li key={s}>・{STEP_LABEL[s]}を再分析</li>
            ))}
            {plan.regeneratePrototype && <li>・プロトタイプ(UI)を再生成</li>}
          </ul>
          <div className="mt-1 flex gap-2">
            <Button size="sm" onClick={() => execute(plan)}>
              承認して実行
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPlan(null)}>
              却下
            </Button>
          </div>
        </Card>
      )}

      {/* 進捗タイムライン */}
      {running && (
        <Card className="gap-1 p-3">
          <p className="text-xs font-semibold text-muted-foreground">実行中</p>
          <ul className="space-y-0.5 text-sm">
            {running.steps.map((s, i) => {
              const done = i < running.doneCount;
              const current = i === running.doneCount;
              return (
                <li key={s}>
                  {done ? "✅" : current ? "⏳" : "⬜️"} {STEP_LABEL[s]}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="要望を入力（Enterで送信）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          disabled={busy}
        />
        <Button onClick={send} disabled={busy || !input.trim()}>
          {busy ? "処理中…" : "送信"}
        </Button>
      </div>
    </Card>
  );
}
