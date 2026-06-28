/**
 * ビルダー向け: 集めた実ユーザーの声(JTBD インタビュー)を統合分析する。
 * N件の声から共通のジョブ/ペイン/機会を抽出し、ジャーニー更新・スコープ優先度の
 * 提案までまとめる。所有者チェックあり。結果は返すのみ（自動で書き戻さない）。
 */
import { NextResponse } from "next/server";
import { generateStructured } from "@/lib/ai/generate";
import type { LlmProvider } from "@/lib/ai/models";
import { voiceSynthesisSchema } from "@/lib/ai/schemas";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectWithArtifacts } from "@/lib/projects";
import { listUserVoices } from "@/lib/user-voices";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  provider?: LlmProvider;
  modelId?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const owned = await getProjectWithArtifacts(user.id, id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const voices = await listUserVoices(id);
  if (!voices.length)
    return NextResponse.json(
      { error: "まだ回答者の声がありません" },
      { status: 400 },
    );

  const body = (await req.json().catch(() => ({}))) as Body;

  // 声をコンパクトにテキスト化（構造化サマリ優先、無ければ会話本文を要約材料に）。
  const voicesText = voices
    .map((v, i) => {
      const s = v.jobSummary as Record<string, unknown> | null;
      if (s) {
        return `### 回答者${i + 1}（構造化済み）\n${JSON.stringify(s)}`;
      }
      const convo = (v.messages ?? [])
        .map((m) => `${m.role === "user" ? "回答者" : "AI"}: ${m.content}`)
        .join("\n");
      return `### 回答者${i + 1}（会話）\n${convo}`;
    })
    .join("\n\n");

  const context = `## プロダクト\n- 名称: ${owned.project.name}\n${
    owned.project.summary ? `- 概要: ${owned.project.summary}\n` : ""
  }\n## 集めた実ユーザーの声（${voices.length}件）\n${voicesText}`;

  let synthesis: unknown;
  try {
    synthesis = await generateStructured({
      schema: voiceSynthesisSchema,
      provider: body.provider,
      modelId: body.modelId,
      temperature: 0.4,
      system:
        "あなたはユーザーリサーチを統合する UX リサーチャー兼プロダクトマネージャーです。複数の実ユーザー（回答者）への JTBD インタビューから、共通して現れるジョブ・ペイン・機会を抽出し、ユーザージャーニーへの反映点と MVP スコープの優先度に関する提案までまとめます。回答者数が少ない場合は断定を避け、傾向として述べます。すべて日本語で、具体的・簡潔に。",
      prompt: context,
    });
  } catch {
    return NextResponse.json(
      { error: "統合分析の生成に失敗しました" },
      { status: 502 },
    );
  }

  return NextResponse.json({ synthesis, respondentCount: voices.length });
}
