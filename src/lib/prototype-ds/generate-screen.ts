/**
 * 構造化プロトタイプ（DSエンジン）: 1画面 = 1 React 関数コンポーネントを生成する。
 *
 * LLM には「DaisyUI＋共通 <Page> を使った関数コンポーネント1つ」だけを書かせ、
 * 出力をサニタイズして shell.ts の組み立てに渡す。骨格はコード側が持つので、
 * ここで多少崩れてもプレースホルダにフォールバックして全体は壊さない。
 */
import { generateText } from "ai";
import { resolveModel, type LlmProvider } from "@/lib/ai/models";
import { DAISYUI_REFERENCE } from "./daisyui-reference";

const SYSTEM_BASE = `あなたは熟練のフロントエンドエンジニアです。アプリの「1画面」を React 関数コンポーネントとして実装します。

# 実行環境（厳守）
- React は UMD グローバル。**import は一切書かない**。
- フックは \`useState\` だけ使用可（\`const { useState } = React\` 済み。そのまま \`useState(...)\` を呼ぶ）。他のフック/ReactDOM/React.xxx は使わない。
- スタイルは **daisyUI 5 のクラス名 + Tailwind CSS v4 ユーティリティのみ**。<style>/CSS/外部リンク/カスタムフォントは書かない。
- 外部ライブラリ・fetch・<script>・<html>/<head>/<body> は書かない。
- データは全てモック（ハードコード）。実データ風に十分な件数を入れる。日本語UI。画像が要る場合は https://picsum.photos/200/300 を使う。

# 使える共通コンポーネント（定義済み・そのまま使う）
- <Page title="画面名" actions={<button className="btn btn-primary btn-sm">…</button>}>…</Page>
  画面の枠。**JSX のルートは必ず <Page> 1つ**にする。AppShell/サイドバー/ナビは骨格側にあるので書かない。

# daisyUI の使い方
- 下の「daisyUI リファレンス」のクラス名・構文・ルールに**厳密に従う**。存在しないクラスを発明しない。
- 既定バリアントを基本とし、色は daisyUI のセマンティックカラー（primary/secondary/accent/base-*/info/success/warning/error）を使う。

# 出力形式（厳守）
- 次の形の関数を **1つだけ** 出力する。説明文・マークダウン・コードフェンス(\`\`\`)は付けない。
- 関数名は必ず \`Screen\`。JSX は className を使う（class ではない）。
function Screen() {
  return (
    <Page title="（画面名）">
      ...
    </Page>
  );
}

# daisyUI リファレンス（厳守）
${DAISYUI_REFERENCE}`;

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
      // TODO(最適化): 大きな daisyUI リファレンスを含む system は prompt caching で
      //   使い回せると、複数画面の並列生成で入力コストを削減できる。
      system: SYSTEM_BASE,
      prompt: `${context}\n\n上記アプリの画面「${label}」の中身を実装してください。関数名は Screen、ルートは <Page title="${label}"> としてください。`,
      temperature: 0.5,
      // 1画面は小さいので控えめ。300秒・並列でも余裕を持たせる。
      maxOutputTokens: 8000,
    });
    const source = sanitizeScreen(text, componentName, label);
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

/** LLM 出力を関数コンポーネント1つに整える。妥当でなければ null。 */
function sanitizeScreen(
  raw: string,
  componentName: string,
  _label: string,
): string | null {
  let t = (raw ?? "").trim();
  // コードフェンス除去
  const fence = t.match(/```(?:jsx|tsx|js|javascript|react)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 関数名 Screen を一意名にリネーム（function / const どちらも）
  if (/function\s+Screen\b/.test(t)) {
    t = t.replace(/function\s+Screen\b/, `function ${componentName}`);
  } else if (/const\s+Screen\s*=/.test(t)) {
    t = t.replace(/const\s+Screen\s*=/, `const ${componentName} =`);
  } else {
    return null; // 期待した形でない
  }
  // 目的のコンポーネントを定義しているか
  if (!new RegExp(`(function|const)\\s+${componentName}\\b`).test(t)) return null;
  // 括弧・波括弧の釣り合い（粗いが、致命的な途中切れを弾く）
  if (!isBalanced(t)) return null;
  return t;
}

function isBalanced(s: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "}": "{", "]": "[" };
  let curly = 0,
    paren = 0,
    square = 0;
  for (const ch of s) {
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") curly++;
    else if (ch === "}") curly--;
    else if (ch === "[") square++;
    else if (ch === "]") square--;
    if (paren < 0 || curly < 0 || square < 0) return false;
    void pairs;
  }
  return paren === 0 && curly === 0 && square === 0;
}

/** 生成に失敗した画面の安全なプレースホルダ。 */
function placeholder(componentName: string, label: string): string {
  return `function ${componentName}() {
  return (
    <Page title="${label.replace(/"/g, "")}">
      <div className="alert alert-warning">この画面はうまく生成できませんでした。「選択を既存に追記」で再生成できます。</div>
    </Page>
  );
}`;
}
