"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LeanQuestLogo } from "@/components/leanquest-logo";
import { signUp } from "@/lib/auth/client";

/** 招待承諾フォーム。メールは固定、氏名・パスワードを設定してアカウント作成する。 */
export function AcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signUpError } = await signUp.email({ name, email, password });
    if (signUpError) {
      setLoading(false);
      setError(signUpError.message ?? "アカウント作成に失敗しました");
      return;
    }
    // サインアップ直後はセッション確立済み。招待を承諾済みにする。
    await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    router.push("/studio");
  }

  return (
    <main className="pm-sky relative isolate flex min-h-screen items-center justify-center px-6">
      <div className="pm-stars pointer-events-none absolute inset-0 -z-10" />

      <div className="pm-panel w-full max-w-sm p-7">
        <div className="flex items-center gap-2">
          <LeanQuestLogo className="h-5 w-auto text-foreground" />
          <span className="font-heading text-sm font-bold tracking-tight">
            LEAN&nbsp;QUEST&nbsp;<span className="text-primary">AI</span>
          </span>
        </div>
        <h1 className="mt-5 font-heading text-2xl font-bold tracking-tight">
          メンバー登録
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          LEAN QUEST AI への招待を受け取りました
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            readOnly
            title={email}
            autoComplete="username"
            aria-label="招待先メールアドレス"
            className="h-10 w-full overflow-hidden text-ellipsis rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
          />
          <input
            required
            placeholder="お名前"
            value={name}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <input
            type="password"
            required
            minLength={8}
            placeholder="パスワード（8文字以上）"
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="h-10 w-full rounded-md bg-primary font-medium text-primary-foreground transition-all hover:opacity-90 active:translate-y-px disabled:opacity-50"
          >
            {loading ? "登録中…" : "登録して始める →"}
          </button>
        </form>
      </div>
    </main>
  );
}
