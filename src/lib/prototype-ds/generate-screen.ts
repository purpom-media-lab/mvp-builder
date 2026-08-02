/**
 * 構造化プロトタイプ（DSエンジン）: 1画面 = 1 React 関数コンポーネントを生成する。
 *
 * LLM には「DaisyUI＋共通 <Page> を使った関数コンポーネント1つ」だけを書かせ、
 * 出力をサニタイズして shell.ts の組み立てに渡す。骨格はコード側が持つので、
 * ここで多少崩れてもプレースホルダにフォールバックして全体は壊さない。
 *
 * system プロンプトは prompt.ts、サニタイズは sanitize.ts にある
 * （Claude Code 版パイプラインと共有するため）。
 */
import { generateText } from "ai";
import { resolveModel, type LlmProvider } from "@/lib/ai/models";
import { DAISYUI_REFERENCE } from "./daisyui-reference";
import { SCREEN_SYSTEM } from "./prompt";
import { placeholder, sanitizeScreen } from "./sanitize";

/** Anthropic の prompt caching ブレークポイント（他プロバイダでは無視される）。 */
const CACHE_BREAKPOINT = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
};

export interface GenerateScreenArgs {
  label: string;
  componentName: string;
  context: string;
  provider?: LlmProvider;
  modelId?: string;
}

export interface GeneratedScreen {
  label: string;
  componentName: string;
  source: string;
  ok: boolean;
}

/** 1画面のコンポーネントソースを生成して返す（失敗時はプレースホルダ）。 */
export async function generateScreenComponent(
  args: GenerateScreenArgs,
): Promise<GeneratedScreen> {
  const { label, componentName, context, provider, modelId } = args;
  try {
    const { text } = await generateText({
      model: resolveModel(provider, modelId),
      system: SCREEN_SYSTEM,
      // 大きな daisyUI リファレンスとアプリ文脈は画面間で不変なので、ここまでを
      // 1つの cache ブレークポイントにまとめる（Anthropic）。同一生成内の並列N画面で
      // [system + リファレンス + 文脈] がキャッシュされ、変化するのは末尾の画面指示だけ。
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `# daisyUI リファレンス（厳守）\n${DAISYUI_REFERENCE}`,
            },
            {
              type: "text",
              text: `# アプリの文脈\n${context}`,
              providerOptions: CACHE_BREAKPOINT,
            },
            {
              type: "text",
              text: `上記アプリの画面「${label}」の中身を実装してください。関数名は Screen、ルートは <Page title="${label}"> としてください。`,
            },
          ],
        },
      ],
      temperature: 0.5,
      // 1画面は小さいので控えめ。300秒・並列でも余裕を持たせる。
      maxOutputTokens: 8000,
    });
    const source = sanitizeScreen(text, componentName);
    return source
      ? { label, componentName, source, ok: true }
      : { label, componentName, source: placeholder(componentName, label), ok: false };
  } catch {
    return {
      label,
      componentName,
      source: placeholder(componentName, label),
      ok: false,
    };
  }
}
