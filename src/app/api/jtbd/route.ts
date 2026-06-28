/**
 * ジョブ理論（Jobs-to-be-Done）モードの要望ヒアリング・チャット。
 * JTBD の枠組みで対話し、まとまったら saveRequirement ツールで
 * プロジェクトの概要＋入力資料に反映する。
 */
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import type { LlmProvider } from "@/lib/ai/catalog";
import { resolveModel } from "@/lib/ai/models";
import { getSessionUser } from "@/lib/auth/session";
import {
  getProjectWithArtifacts,
  saveChatThread,
  saveRequirement,
} from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  messages: UIMessage[];
  projectId?: string;
  provider?: LlmProvider;
  modelId?: string;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { messages, projectId, provider, modelId } = (await req.json()) as Body;
  if (!projectId)
    return Response.json({ error: "projectId is required" }, { status: 400 });

  const p = await getProjectWithArtifacts(user.id, projectId);
  if (!p) return Response.json({ error: "Project not found" }, { status: 404 });

  const result = streamText({
    model: resolveModel(provider, modelId),
    system: `あなたは LEAN QUEST AI の「ジョブ理論（Jobs-to-be-Done）」インタビュアーです。ユーザーが作ろうとしているプロダクトの『要望』を、JTBDの枠組みで対話しながら深掘りします。

進め方:
- 一度に質問は1つ。短く、具体例を交えて聞く。傾聴し、相手の言葉を要約して返してから次へ。
- 次の観点を順に引き出す:
  1. 状況（どんな状況・場面で。いつ、誰が、何をしているとき）
  2. 成し遂げたい進歩（ジョブ。機能ではなく『〜できるようになりたい』という前進）
  3. 現在の代替手段と不満（今は何で済ませていて、何が不便・不満か）
  4. 力学（前進を妨げる不安・惰性／後押しする引力・きっかけ）
  5. 成功の基準（どうなれば「雇って良かった」と言えるか）
- 5〜8往復程度で十分な解像度になったら、ユーザーに「この内容で要望をまとめてよいか」を確認し、合意できたら saveRequirement ツールを呼んで反映する。
- requirement は『状況 / ジョブ / 既存の代替と不満 / 力学 / 成功基準 / 想定アクター』を含む構造化テキスト（日本語、Markdown見出し可）にまとめる。summary は一言の要約。
- ツール反映後は、反映した旨と次の一歩（「分析を実行しましょう」）を簡潔に伝える。

## 現在のプロジェクト
- 名称: ${p.project.name}
${p.project.summary ? `- 概要: ${p.project.summary}` : ""}
${p.detail ? `- 既存の入力資料(ユーザー記入):\n${p.detail.slice(0, 1500)}` : "- 入力資料: まだ未入力"}
${p.analysisResult ? `- 既存の分析結果:\n${p.analysisResult.slice(0, 1500)}` : ""}`,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(3),
    tools: {
      saveRequirement: tool({
        description:
          "ヒアリング結果を、プロジェクトの概要(summary)と入力資料(requirement)としてまとめて保存・反映する。ユーザーの合意が取れてから呼ぶ。",
        inputSchema: z.object({
          summary: z.string().describe("一言の要約（プロジェクト概要に入る）"),
          requirement: z
            .string()
            .describe(
              "構造化した要望テキスト（状況/ジョブ/既存代替と不満/力学/成功基準/想定アクターを含む）",
            ),
        }),
        execute: async ({ summary, requirement }) => {
          await saveRequirement(user.id, projectId, { summary, requirement });
          return { saved: true, summary };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      void saveChatThread(projectId, "jtbd", finalMessages);
    },
  });
}
