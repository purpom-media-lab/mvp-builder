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
        <h1 className="text-2xl font-bold">招待が無効です</h1>
        <p className="mt-2 text-sm text-gray-500">
          この招待リンクは無効、または期限切れです。発行者に再発行を依頼してください。
        </p>
        <Link href="/sign-in" className="mt-6 text-blue-600 underline">
          サインインへ
        </Link>
      </main>
    );
  }

  return <AcceptForm token={token} email={invitation.email} />;
}
