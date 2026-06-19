"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GlobalHeader } from "@/components/global-header";
import { PageLoading } from "@/components/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/auth/client";

type Member = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};
type Invitation = {
  id: string;
  email: string;
  status: "pending" | "accepted" | "revoked";
  token: string;
  expiresAt: string;
  createdAt: string;
};

const STATUS_LABEL: Record<Invitation["status"], string> = {
  pending: "招待中",
  accepted: "参加済み",
  revoked: "取消済み",
};

export default function MembersPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);

  useEffect(() => {
    if (!isPending && !session?.user) router.replace("/sign-in");
  }, [isPending, session, router]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/invitations");
      if (res.ok) {
        const d = await res.json();
        setMembers(d.members ?? []);
        setInvitations(d.invitations ?? []);
      }
    } finally {
      setLoadingMembers(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    const res = await fetch("/api/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(d.error ?? "招待に失敗しました");
      return;
    }
    setInviteUrl(d.inviteUrl);
    setEmailSent(!!d.emailSent);
    setEmail("");
    refresh();
  }

  async function revoke(id: string) {
    await fetch(`/api/invitations/${id}`, { method: "DELETE" });
    refresh();
  }

  async function copyUrl() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  return (
    <div className="min-h-screen bg-background">
      <GlobalHeader back={{ href: "/studio", label: "プロジェクト" }} />
      <main className="mx-auto max-w-3xl px-6 py-8">
        <p className="pm-eyebrow">team · access control</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">
          メンバー
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          オープン登録は無効です。招待したメールアドレスのみが登録できます。
        </p>

        {/* 招待フォーム */}
        <section className="pm-panel mt-6 p-5">
          <h2 className="font-heading font-bold">メンバーを招待</h2>
          <form onSubmit={invite} className="mt-3 flex gap-2">
            <Input
              type="email"
              required
              placeholder="invitee@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "発行中…" : "招待を発行"}
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
          {inviteUrl && (
            <div className="mt-3 rounded-md bg-muted p-3 text-sm">
              {emailSent ? (
                <p className="mb-1 font-medium text-primary">
                  ✅ 招待メールを送信しました（届かない場合は下のリンクを共有）
                </p>
              ) : (
                <p className="mb-1 font-medium">招待リンク（本人に共有してください）</p>
              )}
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs">
                  {inviteUrl}
                </code>
                <Button size="sm" variant="outline" onClick={copyUrl}>
                  {copied ? "コピー済み" : "コピー"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {loadingMembers ? (
          <PageLoading label="読み込み中…" />
        ) : (
          <>
        {/* 招待一覧 */}
        <section className="mt-8">
          <h2 className="font-heading font-semibold">招待</h2>
          {invitations.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">招待はありません。</p>
          ) : (
            <ul className="mt-3 divide-y rounded-lg border">
              {invitations.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      期限: {new Date(inv.expiresAt).toLocaleString("ja-JP")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={inv.status === "pending" ? "default" : "secondary"}
                    >
                      {STATUS_LABEL[inv.status]}
                    </Badge>
                    {inv.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revoke(inv.id)}
                      >
                        取消
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* メンバー一覧 */}
        <section className="mt-8">
          <h2 className="font-heading font-semibold">
            参加メンバー（{members.length}）
          </h2>
          <ul className="mt-3 divide-y rounded-lg border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                  {(m.name || m.email).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
          </>
        )}
      </main>
    </div>
  );
}
