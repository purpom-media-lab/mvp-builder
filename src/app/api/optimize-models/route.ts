import { NextResponse } from "next/server";
import { z } from "zod";
import { MODEL_CATALOG, PROVIDERS } from "@/lib/ai/catalog";
import { generateStructured } from "@/lib/ai/generate";
import type { LlmProvider } from "@/lib/ai/models";
import { getSessionUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 工程×モデルの集計（クライアントの getUsageStats の戻り値と同形）。 */
interface UsageStat {
  provider: string;
  modelId: string;
  count: number;
  avgMs: number;
  okRate: number;
}

interface Body {
  /** step -> モデルごとの集計（履歴が無ければ空）。 */
  stats?: Record<string, UsageStat[]>;
  /** 推奨を出してほしい工程キー一覧。 */
  steps?: string[];
  /** 利用可能なプロバイダ（APIキーが揃っているもの）。 */
  providers?: LlmProvider[];
  /** 最適化自体を実行するモデル（既定: カタログ既定）。 */
  provider?: LlmProvider;
  modelId?: string;
}

const recommendationSchema = z.object({
  recommendations: z
    .array(
      z.object({
        step: z.string().describe("工程キー（入力の steps のいずれか）"),
        provider: z
          .enum(["claude", "openai", "gemini"])
          .describe("推奨プロバイダ"),
        modelId: z
          .string()
          .describe("MODEL_CATALOG の範囲内のモデルID"),
        rationale: z
          .string()
          .describe("なぜこのモデルかの短い理由（日本語・1文）"),
      }),
    )
    .describe("各工程に対する推奨モデル"),
});

type Recommendation = z.infer<typeof recommendationSchema>["recommendations"][number];

/** 軽い抽出系の工程（高速・低コストモデル向き）。 */
const LIGHT_STEPS = new Set(["actors", "usecases", "journey", "navigation"]);

/** カタログ全体を人が読める形に（プロンプト用）。 */
function catalogForPrompt(available: LlmProvider[]): string {
  return available
    .map((p) => {
      const c = MODEL_CATALOG[p];
      return `- ${p}: [${c.models.join(", ")}]（既定: ${c.defaultModel}）`;
    })
    .join("\n");
}

const SYSTEM = `あなたは LLM のコスト/品質最適化アドバイザーです。
MVP 設計支援アプリの「工程ごとのモデル設定」を、利用履歴とモデル特性から最適化します。

# 方針
- 軽い抽出系の工程（actors / usecases / journey / navigation）は、品質影響が小さいので
  高速・低コストモデル（claude-haiku-4-5 / gemini-2.5-flash / gpt-4o-mini）を推奨する。
- 重要な推論系の工程（ooui / scope / kpi / growth / brand / prototype など）は、
  品質を優先して賢いモデル（claude-sonnet-4-6 / gemini-2.5-pro / gpt-4o）を推奨する。
- 利用履歴（stats）で、平均遅延（avgMs）が大きい・成功率（okRate）が低いモデルは避ける。
  履歴が十分にあるモデルが安定して速く成功しているなら、それを尊重してよい。
- 履歴が無い工程は、その工程の性質（軽い抽出系 / 重い推論系）とモデル特性から推奨する。
- 候補は必ず提示された利用可能プロバイダ・MODEL_CATALOG の範囲内のモデルIDだけを使う。
- 入力の steps すべてに対して、ちょうど 1 件ずつ推奨を返す。
- rationale は日本語で簡潔に（1文）。`;

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

  const steps =
    Array.isArray(body.steps) && body.steps.length ? body.steps : [];
  if (!steps.length) {
    return NextResponse.json(
      { error: "steps is required" },
      { status: 400 },
    );
  }

  // 利用可能プロバイダを正規化（不正値は除外、空なら全プロバイダ）
  const available: LlmProvider[] = (
    Array.isArray(body.providers) ? body.providers : []
  ).filter((p): p is LlmProvider => PROVIDERS.includes(p as LlmProvider));
  const usableProviders = available.length ? available : [...PROVIDERS];

  const stats = body.stats ?? {};
  const statsLines = steps
    .map((s) => {
      const rows = stats[s];
      if (!rows || !rows.length) return `- ${s}: 履歴なし`;
      const detail = rows
        .map(
          (r) =>
            `${r.provider}/${r.modelId}（${r.count}回, 平均${r.avgMs}ms, 成功率${Math.round(
              r.okRate * 100,
            )}%）`,
        )
        .join(" / ");
      return `- ${s}: ${detail}`;
    })
    .join("\n");

  const prompt = [
    "# 利用可能プロバイダ / モデルカタログ",
    catalogForPrompt(usableProviders),
    "",
    "# 推奨を出す工程（steps）",
    steps.map((s) => `- ${s}`).join("\n"),
    "",
    "# 軽い抽出系の工程（高速モデル向き）",
    [...LIGHT_STEPS].join(", "),
    "",
    "# 工程ごとの利用履歴（集計）",
    statsLines,
    "",
    "上記を踏まえ、各工程に推奨 { step, provider, modelId, rationale } を返してください。",
  ].join("\n");

  let result: { recommendations: Recommendation[] };
  try {
    result = await generateStructured({
      schema: recommendationSchema,
      system: SYSTEM,
      prompt,
      provider: body.provider,
      modelId: body.modelId,
      temperature: 0.3,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "最適化に失敗しました" },
      { status: 500 },
    );
  }

  // 候補をカタログ・利用可能プロバイダの範囲内に丸める
  const fallbackProvider = usableProviders[0];
  const wantSteps = new Set(steps);
  const byStep = new Map<string, Recommendation>();
  for (const rec of result.recommendations ?? []) {
    if (!rec || !wantSteps.has(rec.step) || byStep.has(rec.step)) continue;
    const provider: LlmProvider = usableProviders.includes(
      rec.provider as LlmProvider,
    )
      ? (rec.provider as LlmProvider)
      : fallbackProvider;
    const models = MODEL_CATALOG[provider].models;
    const modelId = models.includes(rec.modelId)
      ? rec.modelId
      : MODEL_CATALOG[provider].defaultModel;
    byStep.set(rec.step, {
      step: rec.step,
      provider,
      modelId,
      rationale: rec.rationale ?? "",
    });
  }

  const recommendations = steps
    .map((s) => byStep.get(s))
    .filter((r): r is Recommendation => !!r);

  return NextResponse.json({ recommendations });
}
