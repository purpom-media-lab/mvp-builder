"use client";

/**
 * 実ユーザー（回答者）の声 — 集計/統合ビュー（Phase 2）。
 *
 * 公開プロト(/run)のウィジェットで集めた JTBD インタビューを一覧し、
 * 「統合分析」で共通のジョブ/ペイン/機会を抽出して、ジャーニー反映・スコープ
 * 優先度の提案までまとめる。書き戻しは行わず、提案を表示するだけ。
 */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { LoadingOverlay, Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { loadBaseModel } from "@/lib/model-prefs";
import { cn } from "@/lib/utils";

interface VoiceMsg {
  role: string;
  content: string;
}
interface VoiceRow {
  id: string;
  respondentId: string;
  messages: VoiceMsg[] | null;
  jobSummary: Record<string, string | null> | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Synthesis {
  topJobs: { job: string; frequency: string }[];
  topPains: { pain: string; severity: string }[];
  topOpportunities: string[];
  overallSentiment: string;
  journeySuggestions: string[];
  scopeSuggestions: string[];
  summary: string;
}

// jobSummary のキー → 日本語ラベル
const SUMMARY_LABELS: Record<string, string> = {
  situation: "状況",
  job: "ジョブ",
  alternatives: "代替と不満",
  forces: "力学",
  feedback: "試作への感想",
  successCriteria: "成功基準",
};

export default function VoicesPage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState("");
  const [voices, setVoices] = useState<VoiceRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pr, vr] = await Promise.all([
          fetch(`/api/projects/${id}`).then((r) => (r.ok ? r.json() : null)),
          fetch(`/api/projects/${id}/voices`).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]);
        if (!alive) return;
        if (pr?.project?.name) setName(pr.project.name);
        setVoices((vr?.voices as VoiceRow[]) ?? []);
      } catch {
        if (alive) setError("読み込みに失敗しました");
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const completed = voices.filter((v) => v.status === "completed").length;

  async function synthesize() {
    setSynthesizing(true);
    setError(null);
    try {
      const model = loadBaseModel(id);
      const res = await fetch(`/api/projects/${id}/voices/synthesize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: model.provider,
          modelId: model.modelId,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "統合に失敗しました");
      setSynthesis(j.synthesis as Synthesis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "統合に失敗しました");
    } finally {
      setSynthesizing(false);
    }
  }

  return (
    <AppShell
      fullHeight
      back={{ href: `/studio/${id}/prototype`, label: "プロトタイプに戻る" }}
      center={
        <span className="text-sm font-medium text-base-content">
          {name || "…"} / ユーザーの声
        </span>
      }
    >
      {loadingList && <LoadingOverlay label="読み込み中…" />}
      <div className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
            {error}
          </div>
        )}

        {/* ヘッダ: 件数 + 統合ボタン */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">ユーザーの声</h1>
            <p className="text-sm text-base-content/70">
              公開プロト（/run）のインタビューで集まった回答 {voices.length} 件
              （完了 {completed} 件）
            </p>
          </div>
          <Button
            onClick={synthesize}
            disabled={synthesizing || voices.length === 0}
            title={
              voices.length === 0
                ? "まだ回答がありません"
                : "集めた声を統合分析します"
            }
          >
            {synthesizing ? "統合中…" : "🧪 声を統合する"}
          </Button>
        </div>

        {/* 統合結果 */}
        {synthesizing && (
          <div className="flex items-center gap-2 rounded-md border bg-base-200 px-3 py-3 text-sm">
            <Spinner /> 共通のジョブ・ペイン・機会を抽出しています…
          </div>
        )}
        {synthesis && (
          <div className="space-y-4 rounded-lg border bg-base-100 p-4">
            <div>
              <div className="mb-1 text-xs font-semibold text-base-content/60">
                サマリ
              </div>
              <p className="text-sm">{synthesis.summary}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SynthList
                title="🎯 共通のジョブ"
                items={synthesis.topJobs.map(
                  (j) => `${j.job}（${j.frequency}）`,
                )}
              />
              <SynthList
                title="⚠️ 共通のペイン"
                items={synthesis.topPains.map(
                  (p) => `${p.pain}（${p.severity}）`,
                )}
                tone="error"
              />
              <SynthList
                title="💡 機会・インサイト"
                items={synthesis.topOpportunities}
                tone="success"
              />
              <SynthList
                title="🗺 ジャーニーへの反映提案"
                items={synthesis.journeySuggestions}
              />
              <SynthList
                title="📦 スコープ優先度の提案"
                items={synthesis.scopeSuggestions}
              />
              <div>
                <div className="mb-1 text-xs font-semibold text-base-content/60">
                  🌡 全体の受け止め
                </div>
                <p className="text-sm">{synthesis.overallSentiment}</p>
              </div>
            </div>
            <p className="text-xs text-base-content/50">
              ※ 提案です。ジャーニー／スコープへの反映は分析タブで手動で行ってください。
            </p>
          </div>
        )}

        {/* 回答一覧 */}
        {!loadingList && voices.length === 0 ? (
          <div className="rounded-md border border-dashed bg-base-200/40 px-4 py-10 text-center text-sm text-base-content/60">
            まだ回答がありません。プロトタイプを公開（/run）し、共有して声を集めましょう。
          </div>
        ) : (
          <div className="space-y-2">
            {voices.map((v) => {
              const open = openId === v.id;
              return (
                <div key={v.id} className="rounded-md border bg-base-100">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : v.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                  >
                    <span
                      className={cn(
                        "badge badge-sm",
                        v.status === "completed"
                          ? "badge-success"
                          : "badge-warning",
                      )}
                    >
                      {v.status === "completed" ? "完了" : "途中"}
                    </span>
                    <span className="font-mono text-xs text-base-content/60">
                      {v.respondentId.slice(0, 8)}
                    </span>
                    <span className="flex-1 truncate text-base-content/80">
                      {v.jobSummary?.job ||
                        v.messages?.find((m) => m.role === "user")?.content ||
                        "（回答なし）"}
                    </span>
                    <span className="text-xs text-base-content/40">
                      {open ? "▲" : "▼"}
                    </span>
                  </button>
                  {open && (
                    <div className="space-y-3 border-t px-3 py-3 text-sm">
                      {v.jobSummary && (
                        <div className="grid gap-2 rounded-md bg-base-200/50 p-3 sm:grid-cols-2">
                          {Object.entries(SUMMARY_LABELS).map(([k, label]) =>
                            v.jobSummary?.[k] ? (
                              <div key={k}>
                                <div className="text-xs font-semibold text-base-content/60">
                                  {label}
                                </div>
                                <div>{v.jobSummary[k]}</div>
                              </div>
                            ) : null,
                          )}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        {(v.messages ?? []).map((m, i) => (
                          <div
                            key={i}
                            className={cn(
                              "max-w-[85%] rounded-lg px-2.5 py-1.5",
                              m.role === "user"
                                ? "ml-auto bg-primary/10"
                                : "bg-base-200",
                            )}
                          >
                            {m.content}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function SynthList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone?: "error" | "success";
}) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-base-content/60">
        {title}
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((it, i) => (
          <li
            key={i}
            className={cn(
              "rounded bg-base-200/50 px-2 py-1",
              tone === "error" && "text-error",
              tone === "success" && "text-success",
            )}
          >
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
