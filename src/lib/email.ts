/**
 * メール送信（Resend）。RESEND_API_KEY が未設定なら no-op（招待リンク運用にフォールバック）。
 * 送信元は EMAIL_FROM（未設定なら Resend の検証用 onboarding@resend.dev）。
 */
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;
const from = process.env.EMAIL_FROM ?? "LEAN QUEST AI <onboarding@resend.dev>";
const resend = apiKey ? new Resend(apiKey) : null;

export function isEmailConfigured(): boolean {
  return !!resend;
}

type SendResult = { sent: boolean; reason?: string };

/** 招待メールを送信する（招待リンクつき）。失敗してもアプリは止めない。 */
export async function sendInviteEmail(
  to: string,
  inviteUrl: string,
): Promise<SendResult> {
  if (!resend) return { sent: false, reason: "not-configured" };
  try {
    await resend.emails.send({
      from,
      to,
      subject: "LEAN QUEST AI への招待",
      html: inviteEmailHtml(inviteUrl),
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : "failed" };
  }
}

function inviteEmailHtml(inviteUrl: string): string {
  return `<!doctype html>
<html lang="ja"><body style="margin:0;background:#f5f4fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Hiragino Kaku Gothic ProN',sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <p style="font-size:18px;font-weight:700;color:#1a1340;margin:0 0 24px;">LEAN QUEST AI</p>
    <div style="background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e6e4f4;">
      <h1 style="font-size:18px;color:#1a1340;margin:0 0 12px;">チームに招待されました</h1>
      <p style="font-size:14px;color:#4b5563;line-height:1.7;margin:0 0 24px;">
        下のボタンからアカウントを作成すると、LEAN QUEST AI を利用できます。
      </p>
      <a href="${inviteUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:9999px;">
        アカウントを作成する
      </a>
      <p style="font-size:12px;color:#9ca3af;line-height:1.7;margin:24px 0 0;">
        ボタンが押せない場合はこのURLを開いてください:<br/>
        <a href="${inviteUrl}" style="color:#4f46e5;word-break:break-all;">${inviteUrl}</a>
      </p>
    </div>
    <p style="font-size:11px;color:#9ca3af;margin:20px 0 0;">
      この招待に心当たりがない場合は、このメールは破棄してください。
    </p>
  </div>
</body></html>`;
}
