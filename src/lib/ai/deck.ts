/**
 * プロジェクトの分析成果物から「提案資料」の slideData（JSON配列）を生成する。
 * 出力は gslide-data-gen / figma-slide-gen 互換のスライド配列。
 */
import { generateText } from "ai";
import type { SlideData, SlideType } from "../slides/types";
import { resolveModel, type LlmProvider } from "./models";

const KNOWN_TYPES: SlideType[] = [
  "title",
  "section",
  "content",
  "agenda",
  "cards",
  "headerCards",
  "bulletCards",
  "kpi",
  "timeline",
  "process",
  "compare",
  "table",
  "quote",
  "closing",
];

const SCHEMA_DOC = `使用できるスライド型（typeごとの必須/任意フィールド）:
- title: { type, title, date? }
- section: { type, title, subhead?, sectionNo? }   // 章扉
- content: { type, title, subhead?, points?: string[], twoColumn?: boolean, columns?: [string[], string[]] }
- agenda: { type, title, subhead?, items: string[] }
- cards: { type, title, subhead?, columns?: 2|3, items: (string | {title, desc?})[] }
- headerCards: { type, title, subhead?, columns?: 2|3, items: {title, desc?}[] }
- bulletCards: { type, title, subhead?, items: {title, desc}[] }
- kpi: { type, title, subhead?, columns?: 2|3|4, items: {label, value, change?, status?: 'good'|'bad'|'neutral'}[] }
- timeline: { type, title, subhead?, milestones: {label, date, state?: 'done'|'next'|'todo'}[] }
- process: { type, title, subhead?, steps: string[] }
- compare: { type, title, subhead?, leftTitle, rightTitle, leftItems: string[], rightItems: string[] }
- table: { type, title, subhead?, headers: string[], rows: string[][] }
- quote: { type, text, author? }
- closing: { type, message? }
共通: 任意で notes?: string（スピーカーノート）を付けてよい。`;

const SYSTEM = `あなたは新規事業の提案資料を設計するプレゼンテーション設計のプロです。
与えられたプロジェクト情報（概要・課題・MVPスコープ・KPI・グロース計画・ブランド等）から、
投資判断・社内提案に使える「提案資料」のスライド配列 slideData を生成します。

${SCHEMA_DOC}

構成の指針（この順序を基本に、情報がある範囲で作る。10〜16枚程度）:
1. title（表紙: プロダクト名）
2. section「課題」→ content/bulletCards で解くべき課題
3. section「ソリューション」→ MVPの提供価値（mvpStatement）を content か headerCards で
4. section「MVPスコープ」→ cards か table で「最初に作る機能（≤10）」
5. kpi で北極星指標＋主要KPI（value/change を実数値風に）
6. section「グロース計画」→ process か timeline か bulletCards で施策・マイルストーン
7. content か cards でブランドの方向性（任意）
8. timeline でロードマップ（任意）
9. closing

厳守:
- 出力は **JSON配列のみ**。前後の説明文・マークダウン・コードフェンス(\`\`\`)を一切付けない。
- 各要素は必ず有効な type を持つ。日本語。1スライドの文字量は簡潔に（箇条書きは1行20〜30字目安、要素数は3〜6）。`;

/** コードフェンス等を除去して JSON 配列本体を取り出す */
function extractJsonArray(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t.trim();
}

function parseSlides(text: string): SlideData[] {
  const json = extractJsonArray(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("資料データ(JSON)の解析に失敗しました");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("資料データが配列ではありません");
  }
  const slides = parsed.filter(
    (s): s is SlideData =>
      !!s &&
      typeof s === "object" &&
      typeof (s as { type?: unknown }).type === "string" &&
      KNOWN_TYPES.includes((s as { type: SlideType }).type),
  );
  if (!slides.length) throw new Error("有効なスライドが生成されませんでした");
  return slides;
}

export async function generateDeck(
  context: string,
  provider?: LlmProvider,
  modelId?: string,
): Promise<SlideData[]> {
  const { text } = await generateText({
    model: resolveModel(provider, modelId),
    system: SYSTEM,
    prompt: context,
    temperature: 0.4,
  });
  return parseSlides(text);
}
