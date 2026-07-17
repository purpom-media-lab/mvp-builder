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
- navigate("画面名") … 別画面へ遷移するグローバル関数。**「# 遷移」で指定された画面名にのみ**使う（画面名を発明しない）。遷移先の指定が無い操作は、モーダル(dialog)やインライン表示で画面内に完結させる。

# daisyUI の使い方
- 与える「daisyUI リファレンス」のクラス名・構文・ルールに**厳密に従う**。存在しないクラスを発明しない。
- まず意図に合うコンポーネントをリファレンスから選び（名前ではなく振る舞いで判断）、その仕様どおりに組む。
- コンポーネント本体クラス（btn / card / menu / tabs / table / stats / alert / badge / input / select 等）＋ 子パーツクラス（card-body, card-title, card-actions / stat, stat-title, stat-value / menu-title / navbar-start 等）＋ 修飾子クラスの3層で正しく組む。パーツ/修飾子を省略してユーティリティだけで自作しない。
- 既定バリアントを基本とし、色は daisyUI のセマンティックカラー（primary/secondary/accent/info/success/warning/error と base-100/200/300・base-content）を使う。生のカラー（bg-white, bg-gray-100, text-black, bg-blue-500 等）は使わない。
- 面の重なり（elevation）は base 階層で表す: ページ地=base-200、カード/パネル等の面=base-100、境界線=border-base-300、文字=base-content。primary はアクション/アクセントにのみ使い、背景の塗りつぶしに多用しない。

# daisyUI 5 の修飾子（v4 からの非互換・厳守）
- アクティブ状態は **コンポーネント接頭辞付き** の修飾子を使う: menu の選択項目は \`menu-active\`（× \`active\`）、tab の選択は \`tab-active\`（× \`tab-active\` 以外）、ステップは \`step-primary\`。
- タブは \`tabs\`＋\`tab\`、スタイルは \`tabs-box\` / \`tabs-border\` / \`tabs-lift\`（× v4 の \`tabs-boxed\` / \`tab-bordered\`）。
- カードのボーダーは \`card-border\`（× \`card-bordered\`）。サイズは \`card-xs\`〜\`card-xl\`（× \`card-compact\`）。
- 入力まわりは \`input\` / \`select\` / \`textarea\` 単体で使う（× \`input-bordered\` / \`select-bordered\`）。ラベル等のまとまりに v4 の \`form-control\` は使わず、\`fieldset\` + \`label\` または素の Tailwind レイアウトで組む。
- stat は外側 \`stats\`＋各項目 \`stat\`、内部は \`stat-title\` / \`stat-value\` / \`stat-desc\` / \`stat-figure\`。
- バッジ/アラート等の淡色は \`*-soft\`、輪郭は \`*-outline\`、破線は \`*-dash\`（例: \`badge-soft badge-primary\`, \`alert-soft alert-success\`）。

# 出力形式（厳守）
- 次の形の関数を **1つだけ** 出力する。説明文・マークダウン・コードフェンス(\`\`\`)は付けない。
- 関数名は必ず \`Screen\`。JSX は className を使う（class ではない）。
function Screen() {
  return (
    <Page title="（画面名）">
      ...
    </Page>
  );
}`;

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
      system: SYSTEM_BASE,
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
      <div className="alert alert-warning">この画面はうまく生成できませんでした。「未生成だけ選択」→「プレビュー再生成」で作り直せます（他の画面は保持されます）。</div>
    </Page>
  );
}`;
}
