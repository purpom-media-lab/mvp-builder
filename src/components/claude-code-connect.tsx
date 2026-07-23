"use client";

/**
 * Claude Code（MCP）連携カード。
 *
 * ダッシュボードに置き、パーソナルトークンを発行して `claude mcp add` の
 * 接続コマンドを表示・コピーできるようにする。トークンは発行時にしか
 * 表示されない（ステートレスなのでサーバ側にも保存されない）。
 */
import { useState } from "react";

type IssueResponse = {
  token: string;
  url: string;
  expiresAt: string;
  command: string;
};

export function ClaudeCodeConnect() {
  const [issued, setIssued] = useState<IssueResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function issue() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/integrations/claude", { method: "POST" });
      if (!res.ok) throw new Error(`発行に失敗しました (${res.status})`);
      setIssued((await res.json()) as IssueResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!issued) return;
    await navigator.clipboard.writeText(issued.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-8 rounded-box border border-base-300 bg-base-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold">Claude Code 連携</h2>
          <p className="mt-1 text-sm text-base-content/70">
            MCP でプロジェクトの分析・設計データを Claude Code
            から参照できます。接続トークンを発行し、ターミナルでコマンドを実行してください。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={issue}
          disabled={loading}
        >
          {loading ? (
            <span className="loading loading-spinner loading-xs" />
          ) : issued ? (
            "再発行"
          ) : (
            "接続コマンドを発行"
          )}
        </button>
      </div>

      {error && (
        <div className="alert alert-error mt-4 py-2 text-sm">{error}</div>
      )}

      {issued && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-base-content/60">
              有効期限: {new Date(issued.expiresAt).toLocaleDateString("ja-JP")}
              ・トークンはこの画面でのみ表示されます
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={copy}
            >
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded-box bg-base-200 p-3 text-xs leading-relaxed">
            {issued.command}
          </pre>
        </div>
      )}
    </div>
  );
}
