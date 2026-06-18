import Link from "next/link";
import { getValidInvitationByToken } from "@/lib/invitations";
import { AcceptForm } from "./accept-form";

export const runtime = "nodejs";

/** 招待承諾ページ。トークンをサーバ検証し、有効なら登録フォームを表示する。 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await getValidInvitationByToken(token);

  if (!invitation) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 text-center">
        <p className="pm-eyebrow mx-auto">invite · expired</p>
        <h1 className="mt-3 font-heading text-2xl font-semibold tracking-tight">
          招待が無効です
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          この招待リンクは無効、または期限切れです。発行者に再発行を依頼してください。
        </p>
        <Link
          href="/sign-in"
          className="mt-6 font-mono text-sm text-primary underline-offset-4 hover:underline"
        >
          サインインへ →
        </Link>
      </main>
    );
  }

  return <AcceptForm token={token} email={invitation.email} />;
}
