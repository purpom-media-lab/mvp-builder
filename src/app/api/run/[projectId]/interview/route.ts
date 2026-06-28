/**
 * 公開ユーザーインタビュー API（ログイン不要）。
 *
 * 公開プロト(/run)に埋め込んだウィジェットから、匿名の回答者（実ユーザー）に
 * ジョブ理論(JTBD)でインタビューする。回答者本人へのインタビューであり、
 * ビルダーの要望ヒアリング(/api/jtbd)とは別物。会話がまとまったら
 * saveVoiceSummary ツールで構造化サマリを保存する（プロジェクト要望は上書きしない）。
 */
import { eq } from "drizzle-orm";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/ai/models";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { saveUserVoice, type VoiceMessage } from "@/lib/user-voices";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ projectId: string }> };

interface Body {
  messages?: VoiceMessage[];
  respondentId?: string;
}

const ROLES = new Set(["user", "assistant"]);

export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const respondentId = body.respondentId?.trim();
  if (!respondentId)
    return Response.json({ error: "respondentId is required" }, { status: 400 });

  // 受信メッセージを健全化（role を限定、content を文字列に）。
  const incoming: VoiceMessage[] = (body.messages ?? [])
    .filter((m) => m && ROLES.has(m.role) && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));

  // プロジェクト存在確認＋インタビュー文脈（所有者チェックはしない＝公開）。
  const rows = await db
    .select({ name: projects.name, summary: projects.summary })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!rows.length)
    return Response.json({ error: "Project not found" }, { status: 404 });
  const project = rows[0];

  const system = `あなたは、ある新しいプロダクトの試作（プロトタイプ）を試してくれた人に、ジョブ理論(Jobs-to-be-Done)でインタビューする、丁寧でフレンドリーなインタビュアーです。相手は開発者ではなく「実際に使うかもしれない人（回答者）」です。

進め方:
- 日本語で、一度に1問ずつ。短く、答えやすく。相手の言葉を一言要約してから次の質問へ。
- 次の観点を順に引き出す:
  1. 状況（どんな場面・状況でこれを使いたい/必要と感じたか。いつ、何をしているとき）
  2. 成し遂げたい進歩（ジョブ。「〜できるようになりたい」という前進。機能名ではなく）
  3. 今の代替手段と不満（今は何で済ませているか、その不便・不満）
  4. 力学（使うのを妨げる不安・面倒／後押しするきっかけ）
  5. 試作への率直な感想（良かった点・分かりにくかった点・足りないと感じた点）
- 4〜6往復で十分に聞けたら、お礼を述べてから saveVoiceSummary ツールを呼び、構造化サマリを保存する。保存後はお礼を一言だけ。
- 専門用語・誘導は避け、相手が自由に話せるようにする。

## 試してもらったプロダクト
- 名称: ${project.name}
${project.summary ? `- 概要: ${project.summary}` : ""}`;

  // 会話末の構造化サマリは tool 経由で受け取り、保存する。
  let captured: Record<string, unknown> | null = null;
  const saveVoiceSummary = tool({
    description:
      "インタビューが十分にできたら、回答者の声を構造化して保存する。会話の最後に一度だけ呼ぶ。",
    inputSchema: z.object({
      situation: z.string().describe("状況（いつ・どんな場面で使いたいか）"),
      job: z.string().describe("片付けたいジョブ（成し遂げたい進歩）"),
      alternatives: z.string().describe("現在の代替手段と不満"),
      forces: z.string().describe("力学（妨げる不安・面倒／後押しするきっかけ）"),
      feedback: z.string().describe("試作への率直な感想（良い点/分かりにくい点/不足）"),
      successCriteria: z
        .string()
        .nullable()
        .describe("成功基準（どうなれば満足か）。不明なら null"),
    }),
    execute: async (input) => {
      captured = input as Record<string, unknown>;
      return { saved: true };
    },
  });

  // 初回（メッセージなし）でも開始できるよう、空ならキックオフを与える。
  const convo: VoiceMessage[] = incoming.length
    ? incoming
    : [{ role: "user", content: "プロトタイプを試しました。" }];

  let reply = "";
  try {
    const result = await generateText({
      model: resolveModel(),
      system,
      messages: convo.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      tools: { saveVoiceSummary },
      stopWhen: stepCountIs(3),
    });
    reply = result.text?.trim() || "ありがとうございます。";
  } catch {
    return Response.json(
      { error: "インタビューの生成に失敗しました" },
      { status: 502 },
    );
  }

  const done = captured !== null;
  // 会話全文（incoming + 今回の返信）を保存。tool 起動時は completed。
  const fullMessages: VoiceMessage[] = [
    ...incoming,
    { role: "assistant", content: reply },
  ];
  try {
    await saveUserVoice(projectId, respondentId, {
      messages: fullMessages,
      jobSummary: captured,
      status: done ? "completed" : "in_progress",
    });
  } catch {
    // 保存失敗でも会話は返す（声の取りこぼしは許容、UXを止めない）。
  }

  return Response.json({ reply, done });
}
