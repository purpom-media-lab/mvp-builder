"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">メンバー登録</h1>
      <p className="mt-1 text-sm text-gray-500">
        MVP Builder への招待を受け取りました
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <input
          type="email"
          value={email}
          readOnly
          aria-label="招待先メールアドレス"
          className="w-full rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-gray-600"
        />
        <input
          required
          placeholder="お名前"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="パスワード（8文字以上）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-black px-4 py-2.5 font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "登録中…" : "登録して始める"}
        </button>
      </form>
    </main>
  );
}
