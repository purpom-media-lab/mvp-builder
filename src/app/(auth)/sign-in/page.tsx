"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LeanQuestLogo } from "@/components/leanquest-logo";
import { signIn } from "@/lib/auth/client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await signIn.email({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message ?? "サインインに失敗しました");
      return;
    }
    router.push("/studio");
  }

  return (
    <main className="pm-sky relative isolate flex min-h-screen items-center justify-center px-6">
      <div className="pm-stars pointer-events-none absolute inset-0 -z-10" />

      <div className="pm-panel w-full max-w-sm p-7">
        <div className="flex items-center gap-2">
          <LeanQuestLogo className="h-5 w-auto text-base-content" />
          <span className="font-heading text-sm font-bold tracking-tight">
            LEAN&nbsp;QUEST&nbsp;<span className="text-primary">AI</span>
          </span>
        </div>
        <h1 className="mt-5 font-heading text-2xl font-bold tracking-tight">
          サインイン
        </h1>
        <p className="pm-eyebrow mt-3">members only · invite required</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="email"
            required
            placeholder="メールアドレス"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full rounded-md border border-base-300 bg-base-100 px-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <input
            type="password"
            required
            placeholder="パスワード"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="h-10 w-full rounded-md border border-base-300 bg-base-100 px-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {error && (
            <p className="rounded-md bg-error/10 px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="h-10 w-full rounded-md bg-primary font-medium text-primary-content transition-all hover:opacity-90 active:translate-y-px disabled:opacity-50"
          >
            {loading ? "サインイン中…" : "サインイン →"}
          </button>
        </form>
      </div>
    </main>
  );
}
