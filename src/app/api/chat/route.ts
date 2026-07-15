/**
 * 会話型チャット（AI SDK streamText + tools）。
 * ユーザーと会話しつつ、分析・画面の変更が必要なときだけ runAnalysis ツールを呼び、
 * 該当工程を依存順に再実行・保存して結果を返す（human-in-the-loop は会話で代替）。
 */
import { convertToModelMessages, stepCountIs, streamText, tool, type ToolSet, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { DEFAULT_PROVIDER, type LlmProvider } from "@/lib/ai/catalog";
import {
  generateActors,
  generateBackendSpec,
  generateBrand,
  generateDataModel,
  generateGrowth,
  generateJourney,
  generateKpi,
  generateMarket,
  generateNavigation,
  generateOoui,
  generateScope,
  generateUseCases,
  generateWireframes,
} from "@/lib/ai/steps";
import { resolveModel } from "@/lib/ai/models";
import { getSessionUser } from "@/lib/auth/session";
import {
  getProjectWithArtifacts,
  saveChatThread,
  saveStepResult,
  type StepKey,
} from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 300;

const STEP_FNS = {
  actors: generateActors,
  usecases: generateUseCases,
  ooui: generateOoui,
  journey: generateJourney,
  market: generateMarket,
  navigation: generateNavigation,
  wireframe: generateWireframes,
  datamodel: generateDataModel,
  backend: generateBackendSpec,
  scope: generateScope,
  kpi: generateKpi,
  growth: generateGrowth,
  brand: generateBrand,
} as const;

const STEP_ORDER: StepKey[] = [
  "actors",
  "usecases",
  "journey",
  "market",
  "ooui",
  "navigation",
  "wireframe",
  "datamodel",
  "backend",
  "scope",
  "kpi",
  "growth",
  "brand",
];

type Artifacts = NonNullable<
  Awaited<ReturnType<typeof getProjectWithArtifacts>>
>;

function buildContext(a: Artifacts): string {
  return [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.detail && `## 入力資料\n${a.detail}`,
    a.analysisResult && `## ジョブ分析\n${a.analysisResult}`,
    a.sourceText && `## 参考資料\n${a.sourceText}`,
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    a.ooui.length && `## OOUIオブジェクト\n${JSON.stringify(a.ooui)}`,
    a.journey.length && `## ジャーニー\n${JSON.stringify(a.journey)}`,
    a.market && `## 市場・競合\n${JSON.stringify(a.market)}`,
    a.navigation.length && `## ナビゲーション\n${JSON.stringify(a.navigation)}`,
    a.wireframes.length && `## ワイヤーフレーム\n${JSON.stringify(a.wireframes)}`,
    a.dataModel.length && `## データ設計\n${JSON.stringify(a.dataModel)}`,
    a.scope.length && `## スコープ\n${JSON.stringify(a.scope)}`,
    a.mvpStatement && `## MVPステートメント\n${a.mvpStatement}`,
    (a.kpi.northStar || a.kpi.supporting.length) &&
      `## KPI\n${JSON.stringify(a.kpi)}`,
    a.growthPlan && `## グロース計画\n${JSON.stringify(a.growthPlan)}`,
    a.brand && `## ブランド\n${JSON.stringify(a.brand)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface Body {
  messages: UIMessage[];
  projectId?: string;
  provider?: LlmProvider;
  modelId?: string;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { messages, projectId, provider, modelId } = (await req.json()) as Body;
  if (!projectId)
    return Response.json({ error: "projectId is required" }, { status: 400 });

  const artifacts = await getProjectWithArtifacts(user.id, projectId);
  if (!artifacts)
    return Response.json({ error: "Project not found" }, { status: 404 });

  const context = buildContext(artifacts);

  // Web 検索/取得は Anthropic のネイティブサーバツール（追加APIキー不要・引用付き）。
  // Claude 以外のプロバイダでは利用できないため、その場合は付けない。
  const webEnabled = (provider ?? DEFAULT_PROVIDER) === "claude";
  const webTools: ToolSet = webEnabled
    ? {
        web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }),
        web_fetch: anthropic.tools.webFetch_20250910({
          maxUses: 5,
          citations: { enabled: true },
          maxContentTokens: 50000,
        }),
      }
    : {};

  const result = streamText({
    model: resolveModel(provider, modelId),
    system: `あなたは LEAN QUEST AI のアシスタントです。ユーザーと自然に会話しながら、MVPの分析・設計（アクター/ユースケース/モデリング/ジャーニー/ナビゲーション/ワイヤー/データ設計/バックエンド/スコープ/KPI/ブランド）の相談に乗ります。

- 単なる質問・相談には会話で答え、ツールは呼ばないでください。
- ユーザーの要望が「分析内容や画面の変更・作り直し」を伴う場合のみ runAnalysis ツールを呼びます。関係する最小限の工程だけ steps に指定してください（依存順: ${STEP_ORDER.join("→")}）。画面構成・UIの変更を伴うなら regeneratePrototype=true。${
      webEnabled
        ? `
- 最新情報・市場/競合の調査・事実確認が必要なとき、または知らない固有名詞・URLが出てきたときは web_search で検索し、特定ページの中身が必要なら web_fetch でそのURLを読み込みます。結果は鵜呑みにせず要点をまとめ、参照元（URL）を明示してください。ユーザーがURLを貼った場合は web_fetch で読みに行ってから答えます。`
        : ""
    }
- ツール実行後は、何をどう更新したか／何が分かったかを簡潔な日本語でまとめてください。

## 現在の分析状態
${context}`,
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(6),
    tools: {
      ...webTools,
      runAnalysis: tool({
        description:
          "指定した分析工程を再実行して保存し、UIに反映する。分析内容や画面の変更要望のときだけ使う。",
        inputSchema: z.object({
          steps: z
            .array(
              z.enum([
                "actors",
                "usecases",
                "ooui",
                "journey",
                "market",
                "navigation",
                "wireframe",
                "datamodel",
                "backend",
                "scope",
                "kpi",
                "growth",
                "brand",
              ]),
            )
            .describe("再実行する工程（関係する最小限）"),
          requirement: z
            .string()
            .describe("ユーザーの変更要望（生成時に反映する具体的な指示）"),
          regeneratePrototype: z
            .boolean()
            .describe("UI/画面構成の変更を伴うなら true"),
        }),
        execute: async ({ steps, requirement, regeneratePrototype }) => {
          // ooui（モデリング）を再実行するときは、ナビゲーションを OOUI から
          // 自動導出し直すため navigation を必ず後続に含める。
          const requested = new Set<StepKey>(steps);
          if (requested.has("ooui")) requested.add("navigation");
          const ordered = STEP_ORDER.filter((s) => requested.has(s));
          let ctx = `${context}\n\n## ユーザーからの変更要望（必ず反映すること）\n${requirement}`;
          const results: Record<string, unknown> = {};
          for (const step of ordered) {
            const r = await STEP_FNS[step]({ context: ctx, provider, modelId });
            await saveStepResult(user.id, projectId, step, r);
            results[step] = r;
            ctx += `\n\n## ${step}（更新）\n${JSON.stringify(r)}`;
          }
          return { ranSteps: ordered, results, regeneratePrototype };
        },
      }),
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: ({ messages: finalMessages }) => {
      void saveChatThread(projectId, "analysis", finalMessages);
    },
  });
}
