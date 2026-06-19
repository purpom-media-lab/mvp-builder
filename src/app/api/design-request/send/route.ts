/**
 * デザイナー連携: リファイン依頼をメールで送信する。
 * - POST: { projectId, to, brief } を受け取り、ブリーフを Markdown 化して
 *   Resend で送信。送信できたら既存の saveDesignRequest で status を 'requested'
 *   に更新する（projects.ts は編集せず、既存の export 関数を呼ぶだけ）。
 *   Resend 未設定時は { sent:false, reason:"not-configured" } を返す。
 */
import { NextResponse } from "next/server";
import type { DesignBriefOutput } from "@/lib/ai/schemas";
import { getSessionUser } from "@/lib/auth/session";
import { sendDesignRequestEmail } from "@/lib/email";
import { saveDesignRequest } from "@/lib/projects";

export const runtime = "nodejs";

interface Body {
  projectId?: string;
  to?: string;
  brief?: DesignBriefOutput | null;
}

/** デザインブリーフ → デザイナーに渡す Markdown（page 側と同等。重複だが page を壊さないためローカルに保持） */
function briefToMarkdown(b: DesignBriefOutput): string {
  const labelOf = b.deliverable === "figma" ? "Figma データ" : "PDF";
  return [
    `# デザインリファイン依頼: ${b.productName || "（プロダクト名未設定）"}`,
    ``,
    `## プロダクト概要`,
    b.overview || "—",
    ``,
    `## リファインの目的`,
    b.objective || "—",
    ``,
    `## ターゲット / ペルソナ`,
    b.targetUsers || "—",
    ``,
    `## 対象画面・スコープ`,
    b.scopeScreens || "—",
    ``,
    `## ブランド（配色・トーンマナー・ロゴ方向）`,
    b.brand || "—",
    ``,
    `## 参考デザイン・トンマナ参照`,
    b.references || "—",
    ``,
    `## 制約（アクセシビリティ / ブランドガイド / 技術）`,
    b.constraints || "—",
    ``,
    `## 重視点・改善要望`,
    b.emphasis || "—",
    ``,
    `## 成果物形式`,
    `- ${labelOf}`,
    ``,
    `## 納期`,
    b.deadline || "未定",
    ``,
  ].join("\n");
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectId) {
    return NextResponse.json({ error: "projectId は必須です" }, { status: 400 });
  }
  if (!body.to || !EMAIL_RE.test(body.to)) {
    return NextResponse.json(
      { error: "有効なデザイナーのメールアドレスを指定してください" },
      { status: 400 },
    );
  }
  if (!body.brief) {
    return NextResponse.json({ error: "brief は必須です" }, { status: 400 });
  }

  const brief = body.brief;
  const markdown = briefToMarkdown(brief);
  // references に URL があれば参考リンクとしてメール上部にも掲示する。
  const figmaOrPdf = (brief.references ?? "").match(/https?:\/\/\S+/)?.[0];

  const result = await sendDesignRequestEmail(body.to, {
    productName: brief.productName,
    markdown,
    figmaOrPdf,
  });

  // 送信できた場合のみ status を requested に更新（所有権チェックは saveDesignRequest 側）。
  if (result.sent) {
    const row = await saveDesignRequest(user.id, body.projectId, {
      brief,
      status: "requested",
    });
    if (!row)
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
