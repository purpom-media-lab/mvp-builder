/**
 * Claude（など選択 LLM）で「自己完結 HTML プロトタイプ」を生成する。
 *
 * v0 の代替エンジン。OOUI パイプラインの成果物を 1 つの index.html
 * （Tailwind / React を CDN 読み込み・モックデータ内蔵・画面遷移つき）に
 * 変換する。バックエンド不要なので S3 等のホスティングなしに iframe srcDoc で
 * そのままプレビューできる。
 */
import { generateText, streamText } from "ai";
import { resolveModel, type LlmProvider } from "./ai/models";
import { buildPrototypePrompt, type PrototypeContext } from "./v0";

const SYSTEM = `あなたは熟練のフロントエンドエンジニアです。与えられた要件から、クリック可能な UI プロトタイプを「単一の HTML ファイル」として出力してください。

厳守事項:
- 出力は完全な HTML ドキュメント 1 つのみ。説明文・マークダウン・コードフェンス(\`\`\`)は一切付けない。
- <!DOCTYPE html> から始め </html> で終わる。
- Tailwind CSS は CDN(<script src="https://cdn.tailwindcss.com"></script>)で読み込む。
- 画面遷移はタブ/ビュー切替で実現し、JavaScript で動作させる（ページ遷移でなく状態切替）。
- データはすべてモック（ハードコード）。外部 API は呼ばない（CDN の読み込みのみ許可）。
- 日本語 UI。実データ風のサンプルを十分に入れ、一覧→詳細→ダッシュボード等が実際にクリックで行き来できること。
- レスポンシブで、見た目は清潔でモダンに。`;

/** コードフェンスや前後の余計なテキストを除去して HTML 本体だけ取り出す */
function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  return t.trim();
}

export async function generatePrototypeHtml(
  ctx: PrototypeContext,
  provider?: LlmProvider,
  modelId?: string,
): Promise<string> {
  const { text } = await generateText({
    model: resolveModel(provider, modelId),
    system: SYSTEM,
    prompt: buildPrototypePrompt(ctx),
    temperature: 0.6,
  });
  return extractHtml(text);
}

const UPDATE_SYSTEM = `${SYSTEM}

あなたは既存の HTML プロトタイプを「修正」します。現在の HTML 全体と修正指示が与えられます。
指示を反映した上で、これまでの構成・データ・動作を可能な限り保持し、完全な HTML 全体を出力してください（差分ではなく全文）。`;

/** 直前の HTML に修正指示を反映した、更新版 HTML 全文を返す */
export async function updatePrototypeHtml(
  currentHtml: string,
  instruction: string,
  provider?: LlmProvider,
  modelId?: string,
): Promise<string> {
  const { text } = await generateText({
    model: resolveModel(provider, modelId),
    system: UPDATE_SYSTEM,
    prompt: `## 現在のHTML\n${currentHtml}\n\n## 修正指示\n${instruction}`,
    temperature: 0.5,
  });
  return extractHtml(text);
}

type OnComplete = (html: string) => Promise<void> | void;

/**
 * 生成をストリーミングで返す版。逐次トークンを流すので長時間でも接続が切れにくい。
 * 完了時に onComplete(整形済みHTML) で保存などを行う。`toTextStreamResponse()` で
 * そのままレスポンス化する。
 */
export function streamPrototypeHtml(
  ctx: PrototypeContext,
  provider?: LlmProvider,
  modelId?: string,
  onComplete?: OnComplete,
) {
  return streamText({
    model: resolveModel(provider, modelId),
    system: SYSTEM,
    prompt: buildPrototypePrompt(ctx),
    temperature: 0.6,
    onFinish: async ({ text }) => {
      await onComplete?.(extractHtml(text));
    },
  });
}

/** 既存 HTML に修正指示を反映する版（ストリーミング）。 */
export function streamUpdatePrototypeHtml(
  currentHtml: string,
  instruction: string,
  provider?: LlmProvider,
  modelId?: string,
  onComplete?: OnComplete,
) {
  return streamText({
    model: resolveModel(provider, modelId),
    system: UPDATE_SYSTEM,
    prompt: `## 現在のHTML\n${currentHtml}\n\n## 修正指示\n${instruction}`,
    temperature: 0.5,
    onFinish: async ({ text }) => {
      await onComplete?.(extractHtml(text));
    },
  });
}
