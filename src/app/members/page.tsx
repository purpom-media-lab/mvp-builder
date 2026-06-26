"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageLoading } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useSession } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

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

/** 招待ステータス → daisyUI badge の色（soft スタイル）。 */
const STATUS_BADGE: Record<Invitation["status"], string> = {
  pending: "badge-warning",
  accepted: "badge-success",
  revoked: "badge-ghost",
};

function InvitationStatusBadge({ status }: { status: Invitation["status"] }) {
  return (
    <span
      className={cn(
        "badge badge-sm badge-soft whitespace-nowrap",
        STATUS_BADGE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

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
  // 招待一覧の各行ごとのリンクコピー済み表示
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 操作完了の簡易トースト（取消・コピーなど）
  const [toast, setToast] = useState<string | null>(null);
  // accepted/revoked の履歴は既定で隠す
  const [showHistory, setShowHistory] = useState(false);
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

  // トーストは数秒で自動的に消す
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  function inviteLink(token: string): string {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/invite/${token}`;
  }

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

  async function revoke(id: string, target: string) {
    if (!window.confirm(`${target} への招待を取り消しますか？`)) return;
    await fetch(`/api/invitations/${id}`, { method: "DELETE" });
    setToast("招待を取り消しました");
    refresh();
  }

  async function copyUrl() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
  }

  async function copyRowLink(inv: Invitation) {
    await navigator.clipboard.writeText(inviteLink(inv.token));
    setCopiedId(inv.id);
    setToast("招待リンクをコピーしました");
  }

  const pending = invitations.filter((i) => i.status === "pending");
  const history = invitations.filter((i) => i.status !== "pending");

  return (
    <AppShell back={{ href: "/studio", label: "プロジェクト" }}>
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="pm-eyebrow">team · access control</p>
        <h1 className="mt-2 font-heading text-3xl font-bold tracking-tight">
          メンバー
        </h1>
        <p className="mt-1 text-sm text-base-content/70">
          オープン登録は無効です。招待したメールアドレスのみ登録できます。登録済みメンバーは誰でも招待できます。
        </p>

        {loadingMembers ? (
          <PageLoading label="読み込み中…" />
        ) : (
          <Tabs defaultValue="members" className="mt-6">
            <TabsList>
              <TabsTrigger value="members">
                メンバー（{members.length}）
              </TabsTrigger>
              <TabsTrigger value="invitations">
                招待（{pending.length}）
              </TabsTrigger>
            </TabsList>

            {/* === メンバー === */}
            <TabsContent value="members" className="mt-4">
              <div className="overflow-x-auto rounded-xl border border-base-300 bg-base-100">
                <table className="table table-zebra">
                  <thead>
                    <tr>
                      <th>氏名</th>
                      <th>メール</th>
                      <th className="whitespace-nowrap">参加日</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const isMe = m.id === session?.user?.id;
                      return (
                        <tr key={m.id}>
                          <td>
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-semibold">
                                {(m.name || m.email).charAt(0).toUpperCase()}
                              </div>
                              <span className="font-medium">
                                {m.name}
                                {isMe && (
                                  <span className="ml-1.5 text-xs font-normal text-base-content/70">
                                    （あなた）
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="text-base-content/70">{m.email}</td>
                          <td className="whitespace-nowrap text-base-content/70">
                            {m.createdAt
                              ? new Date(m.createdAt).toLocaleDateString("ja-JP")
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* === 招待 === */}
            <TabsContent value="invitations" className="mt-4 space-y-8">
              {/* 招待フォーム（join: input + button） */}
              <section>
                <h2 className="font-heading font-bold">メンバーを招待</h2>
                <form onSubmit={invite} className="mt-3">
                  <div className="join w-full sm:max-w-md">
                    <Input
                      type="email"
                      required
                      autoComplete="off"
                      placeholder="invitee@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="join-item"
                    />
                    <Button type="submit" disabled={busy} className="join-item">
                      {busy ? "発行中…" : "招待を発行"}
                    </Button>
                  </div>
                </form>
                {error && <p className="mt-2 text-sm text-error">{error}</p>}
                {inviteUrl && (
                  <div className="mt-3 rounded-md border border-base-300 bg-base-200 p-3 text-sm">
                    {emailSent ? (
                      <p className="mb-1 font-medium text-primary">
                        ✅
                        招待メールを送信しました（届かない場合は下のリンクを共有）
                      </p>
                    ) : (
                      <p className="mb-1 font-medium">
                        招待リンク（本人に共有してください）
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <code
                        title={inviteUrl}
                        className="flex-1 truncate rounded bg-base-100 px-2 py-1 text-xs"
                      >
                        {inviteUrl}
                      </code>
                      <Button size="sm" variant="outline" onClick={copyUrl}>
                        {copied ? "コピー済み" : "コピー"}
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              {/* 招待中 */}
              <section>
                <h2 className="font-heading font-semibold">
                  招待中（{pending.length}）
                </h2>
                {pending.length === 0 ? (
                  <p className="mt-2 text-sm text-base-content/70">
                    招待中のメンバーはいません。
                  </p>
                ) : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-base-300 bg-base-100">
                    <table className="table table-zebra">
                      <thead>
                        <tr>
                          <th>メール</th>
                          <th>状態</th>
                          <th className="whitespace-nowrap">期限</th>
                          <th className="text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((inv) => (
                          <tr key={inv.id}>
                            <td className="font-medium">{inv.email}</td>
                            <td>
                              <InvitationStatusBadge status={inv.status} />
                            </td>
                            <td className="whitespace-nowrap text-base-content/70">
                              {new Date(inv.expiresAt).toLocaleDateString(
                                "ja-JP",
                              )}
                            </td>
                            <td className="text-right whitespace-nowrap">
                              <Button
                                size="xs"
                                variant="outline"
                                onClick={() => copyRowLink(inv)}
                                title="招待リンクをコピーして本人に共有できます"
                              >
                                {copiedId === inv.id ? "コピー済み" : "リンク"}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                className="ml-2"
                                onClick={() => revoke(inv.id, inv.email)}
                              >
                                取消
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="mt-3 text-xs text-base-content/70 underline-offset-4 hover:underline"
                  >
                    {showHistory
                      ? "履歴を隠す"
                      : `履歴を表示（${history.length}）`}
                  </button>
                )}
                {showHistory && history.length > 0 && (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-dashed border-base-300 bg-base-100">
                    <table className="table table-zebra">
                      <thead>
                        <tr>
                          <th>メール</th>
                          <th>状態</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((inv) => (
                          <tr key={inv.id}>
                            <td className="text-base-content/70">{inv.email}</td>
                            <td>
                              <InvitationStatusBadge status={inv.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-base-content px-4 py-2 text-sm text-base-200 shadow-lg">
          {toast}
        </div>
      )}
    </AppShell>
  );
}
