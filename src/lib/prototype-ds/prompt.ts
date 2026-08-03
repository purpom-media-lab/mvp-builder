/**
 * 構造化プロトタイプ（DSエンジン）の生成プロンプト。
 *
 * 依存ゼロ（型のみ）。Web アプリ（generate-screen / jobs-runner）と
 * Claude Code 版パイプライン（.claude/skills/mvp-pipeline/scripts/plan-screens.ts、
 * scripts/gen-claude-skill.ts）の両方がここを参照する。
 * プロンプトを二重管理しないための単一ソース。
 */
import type { ScreenUnit } from "./screen-units";

/** 1画面ぶんのコンポーネントを書かせる system プロンプト。 */
export const SCREEN_SYSTEM = `あなたは熟練のフロントエンドエンジニアです。アプリの「1画面」を React 関数コンポーネントとして実装します。

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

export interface BaseContextInput {
  projectName?: string | null;
  summary?: string | null;
  /** このMVPで検証する仮説・提供価値（スコープ確定の宣言） */
  mvpStatement?: string | null;
  oouiObjects?: { name: string; attributes?: string[] | null }[] | null;
  scope?: { name: string; description?: string | null }[] | null;
}

/**
 * 全画面に共通する「アプリの文脈」。
 *
 * 探索プロトタイプなので MVP スコープで絞らず、全ユースケース・全画面を網羅的に作らせる
 * （MVP スコープはこの探索プロトタイプを見たあとに確定する設計）。
 */
export function buildBaseContext(
  input: BaseContextInput,
  units: ScreenUnit[],
): string {
  return [
    `# アプリ: ${input.projectName ?? ""}${input.summary ? `：${input.summary}` : ""}`,
    input.mvpStatement ? `# 想定する提供価値(参考): ${input.mvpStatement}` : "",
    input.oouiObjects?.length
      ? `# 主要オブジェクト（データ単位）: ${input.oouiObjects
          .map(
            (o) =>
              o.name +
              (o.attributes?.length ? `（${o.attributes.join(", ")}）` : ""),
          )
          .join(" / ")}`
      : "",
    `# 方針: これは探索用プロトタイプです。MVPに絞り込まず、全ユースケース・全画面を網羅的に作成してください（取捨選択はこのプロトタイプを見てから別途行います）。`,
    input.scope?.length
      ? `# 主な機能（すべて網羅対象・取捨選択しない）: ${input.scope
          .map((f) => f.name)
          .join(" / ")}`
      : "",
    `# 全画面構成: ${units.map((n) => n.label).join(" / ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 1画面ぶんの文脈。共通の baseContext に、対象画面と遷移の指示を足す。
 *
 * 一覧側には「詳細へ飛べ」、詳細側には「どの一覧の詳細か・戻り導線」を指示する。
 * 画面名を発明させないため、navigate() に渡してよいラベルはここでしか与えない。
 */
export function buildScreenContext(
  baseContext: string,
  unit: ScreenUnit,
  hasDetail: Set<string>,
): string {
  return [
    baseContext,
    `# 対象画面: ${unit.label}` +
      (unit.screenType ? `（${unit.screenType}）` : "") +
      (unit.targetObject ? ` / 主対象オブジェクト: ${unit.targetObject}` : ""),
    // 一覧 → 詳細の遷移指示（詳細画面がある一覧のみ）
    hasDetail.has(unit.label)
      ? `# 遷移: 一覧の各行の「詳細」ボタンや行クリックでは navigate("${unit.label}詳細") を呼んで詳細画面へ遷移する。`
      : "",
    // 詳細画面には「どの一覧の詳細か」と戻り導線を指示
    unit.listLabel
      ? `# この画面は一覧「${unit.listLabel}」の1件を開いた詳細画面。対象オブジェクトの属性の詳細・関連情報・主要アクションを載せ、「← ${unit.listLabel}に戻る」ボタンで navigate("${unit.listLabel}") を呼ぶ。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface BrandContextInput {
  projectName?: string | null;
  brand?: {
    brandName?: string | null;
    tagline?: string | null;
    tone?: string[] | null;
    palette?: { primary?: string | null; accent?: string | null } | null;
  } | null;
}

/** テーマ生成に渡すブランド文脈。 */
export function buildBrandContext(input: BrandContextInput): string {
  const b = input.brand;
  return [
    `# アプリ: ${input.projectName ?? ""}`,
    b?.brandName ? `# ブランド名: ${b.brandName}` : "",
    b?.tagline ? `# タグライン: ${b.tagline}` : "",
    b?.tone?.length ? `# トーン: ${b.tone.join(" / ")}` : "",
    b?.palette?.primary ? `# 基調色(primary): ${b.palette.primary}` : "",
    b?.palette?.accent ? `# アクセント: ${b.palette.accent}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
