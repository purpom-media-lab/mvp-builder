/**
 * 構造化プロトタイプ（DSエンジン）のHTML組み立て。
 *
 * 「崩れない」ことを最優先に、HTMLの骨格（DOCTYPE/head/CDN読込/レイアウト/ナビ/
 * 画面切替ルーター/ErrorBoundary）は **すべてコードで固定生成**する。LLM が作るのは
 * 各画面の React コンポーネント本体だけで、それをこの骨格に差し込んで単一HTMLにする。
 *
 * 実行基盤（ビルド不要・iframe srcDoc で動く）:
 *   React/ReactDOM(UMD) + Babel standalone(JSXをブラウザ変換) + Tailwind(CDN) + DaisyUI(CDN CSS)
 */

export interface DsScreen {
  /** ナビに出す画面名（日本語表示名） */
  label: string;
  /** 一意なコンポーネント名（例: Screen0）。source 内の関数名と一致させること。 */
  componentName: string;
  /** `function Screen0(){ ... return (<JSX/>); }` 形式のソース（LLM生成 or プレースホルダ） */
  source: string;
  /** 親メニューの label（2階層ナビ用）。トップ階層なら null/未指定。 */
  parent?: string | null;
  /** 生成に失敗（プレースホルダ）か。済/失敗バッジの判定に使う。 */
  failed?: boolean;
}

/** ナビ1項目（メニュー構造の組み立て用。group=子を束ねる見出し）。 */
export interface DsNavItem {
  label: string;
  parent?: string | null;
  icon?: string | null;
}

export interface DsBrandPalette {
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
  neutral?: string | null;
  background?: string | null;
}

/** daisyUI 5 の完全テーマ（全セマンティック変数）。値はHEX。 */
export interface DaisyTheme {
  primary?: string;
  primaryContent?: string;
  secondary?: string;
  secondaryContent?: string;
  accent?: string;
  accentContent?: string;
  neutral?: string;
  neutralContent?: string;
  base100?: string;
  base200?: string;
  base300?: string;
  baseContent?: string;
  info?: string;
  infoContent?: string;
  success?: string;
  successContent?: string;
  warning?: string;
  warningContent?: string;
  error?: string;
  errorContent?: string;
  /** 角丸（field/box/selector 共通）例: 0rem/0.25rem/0.5rem/1rem/2rem */
  radius?: string;
  /** 影・立体感 0 or 1 */
  depth?: number;
}

export interface DsBuildOptions {
  projectName: string;
  /** コンポーネントを持つ「実画面」（＝ナビのリーフ）。 */
  screens: DsScreen[];
  /** メニュー構造（親子含む全項目・順序つき）。未指定なら screens からフラット生成。
   *  親(label が他項目の parent になっている)はグループ見出しとして描画し、画面は持たない。 */
  nav?: DsNavItem[];
  /** 完全 daisyUI テーマ（AI生成）。あればこれを最優先で適用。 */
  theme?: DaisyTheme | null;
  /** ブランド分析のパレット（theme が無いときのフォールバック）。 */
  brand?: { palette?: DsBrandPalette | null } | null;
}

/** CDN（プレビュー用・固定）。daisyUI 5 + Tailwind CSS 4 の no-build 公式構成。 */
const CDN = {
  // Tailwind CSS v4 ブラウザビルド（DOM を監視して動的クラスもユーティリティ生成）
  tailwind: "https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4",
  // daisyUI 5 プリビルドCSS（コンポーネント＋テーマ）
  daisyui: "https://cdn.jsdelivr.net/npm/daisyui@5",
  react: "https://unpkg.com/react@18/umd/react.development.js",
  reactDom: "https://unpkg.com/react-dom@18/umd/react-dom.development.js",
  babel: "https://unpkg.com/@babel/standalone/babel.min.js",
};

/**
 * コード製ランタイム（JSX）。LLM は触れない＝壊れない部分。
 * 注意: ここでは JS テンプレートリテラル（バッククォート/`${}`）を使わない
 *       （この文字列自体が TS テンプレートリテラル内にあるため）。
 */
const RUNTIME = `/** @jsxRuntime classic */
/** @jsx React.createElement */
const { useState } = React;

class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err){ return { err: err }; }
  render(){
    if (this.state.err) {
      return (
        <div className="alert alert-error m-4">
          <span>この画面の描画でエラーが発生しました: { String(this.state.err && this.state.err.message) }</span>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell(props){
  const nav = props.nav || [];
  const current = props.current || 0;
  const onNavigate = props.onNavigate;
  return (
    <div className="drawer lg:drawer-open">
      <input id="ds-drawer" type="checkbox" className="drawer-toggle" />
      <div className="drawer-content flex min-h-screen flex-col bg-base-200">
        <div className="navbar border-b border-base-300 bg-base-100">
          <label htmlFor="ds-drawer" className="btn btn-ghost btn-sm lg:hidden">☰</label>
          <span className="px-2 text-sm font-bold">{ props.title }</span>
        </div>
        <div className="flex-1 p-4">{ props.children }</div>
      </div>
      <div className="drawer-side">
        <label htmlFor="ds-drawer" className="drawer-overlay"></label>
        <ul className="menu min-h-full w-60 gap-1 bg-base-100 p-2">
          <li className="menu-title">{ props.title }</li>
          { nav.map(function(item, i){
            var link = function(node){
              var active = node.idx >= 0 && node.idx === current;
              return (
                <a
                  className={ active ? "menu-active" : "" }
                  onClick={function(){ if (node.idx >= 0) onNavigate(node.idx); }}
                >
                  { node.icon ? node.icon + " " : "" }{ node.label }
                </a>
              );
            };
            if (item.children && item.children.length) {
              return (
                <li key={i}>
                  <details open>
                    <summary>{ item.icon ? item.icon + " " : "" }{ item.label }</summary>
                    <ul>
                      { item.children.map(function(c, j){
                        return <li key={j}>{ link(c) }</li>;
                      }) }
                    </ul>
                  </details>
                </li>
              );
            }
            return <li key={i}>{ link(item) }</li>;
          }) }
        </ul>
      </div>
    </div>
  );
}

function Page(props){
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{ props.title }</h1>
        <div className="flex gap-2">{ props.actions }</div>
      </div>
      { props.children }
    </div>
  );
}

/* ==== 以下、各画面コンポーネント（LLM生成） ==== */
__SCREENS__

const NAV = __NAV__;
const SCREENS = __REGISTRY__;

function App(){
  const [cur, setCur] = useState(0);
  const entry = SCREENS[cur];
  const Active = entry && entry.Comp ? entry.Comp : function(){
    return <Page title="（画面なし）"><div className="alert">この画面は生成されていません。</div></Page>;
  };
  return (
    <AppShell title={NAV.title} nav={NAV.items} current={cur} onNavigate={setCur}>
      <ErrorBoundary key={cur}><Active /></ErrorBoundary>
    </AppShell>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
`;

/** 画面ソースを束ね、ナビ(2階層)/レジストリを差し込んでランタイムを完成させる。
 *  screens=コンポーネントを持つリーフ。nav=全メニュー項目(親子・順序つき)。
 *  ある label が他項目の parent になっていれば、その項目はグループ見出し(画面なし idx=-1)。 */
function buildRuntime(opts: DsBuildOptions): string {
  const screenSources = opts.screens.map((s) => s.source).join("\n\n");
  const registry =
    "[" +
    opts.screens
      .map(
        (s) =>
          "{label:" + JSON.stringify(s.label) + ",Comp:" + s.componentName + "}",
      )
      .join(",") +
    "]";

  // label → 画面index（リーフのみ）。グループは index を持たない(-1)。
  const idxOf = new Map<string, number>();
  opts.screens.forEach((s, i) => idxOf.set(s.label, i));

  // メニュー全項目（順序つき）。未指定なら screens からフラット生成。
  const navList: DsNavItem[] =
    opts.nav && opts.nav.length
      ? opts.nav
      : opts.screens.map((s) => ({ label: s.label, parent: s.parent ?? null }));

  type Node = { label: string; icon: string | null; idx: number; children: Node[] };
  const node = (n: DsNavItem): Node => ({
    label: n.label,
    icon: n.icon ?? null,
    idx: idxOf.has(n.label) ? idxOf.get(n.label)! : -1,
    children: [],
  });

  const tops: Node[] = [];
  const byLabel = new Map<string, Node>();
  // 1st: トップ階層(parent なし)
  for (const n of navList) {
    if (!n.parent) {
      const e = node(n);
      tops.push(e);
      byLabel.set(n.label, e);
    }
  }
  // 2nd: 子を親にぶら下げる（親が無ければトップに昇格）
  for (const n of navList) {
    if (n.parent) {
      const child = node(n);
      const parent = byLabel.get(n.parent);
      if (parent) parent.children.push(child);
      else {
        tops.push(child);
        byLabel.set(n.label, child);
      }
    }
  }

  const nav = { title: opts.projectName || "プロトタイプ", items: tops };
  return RUNTIME.replace("__SCREENS__", screenSources)
    .replace("__NAV__", JSON.stringify(nav))
    .replace("__REGISTRY__", registry);
}

const hex = (c?: string | null): string | null =>
  c && /^#?[0-9a-fA-F]{6}$/.test(c.trim())
    ? c.trim().startsWith("#")
      ? c.trim()
      : "#" + c.trim()
    : null;

/** ブランドパレット → 部分テーマ（theme が無いときのフォールバック）。 */
function paletteToTheme(p?: DsBrandPalette | null): DaisyTheme | null {
  if (!p) return null;
  const t: DaisyTheme = {};
  if (hex(p.primary)) {
    t.primary = hex(p.primary)!;
    t.primaryContent = "#ffffff";
  }
  if (hex(p.secondary)) {
    t.secondary = hex(p.secondary)!;
    t.secondaryContent = "#ffffff";
  }
  if (hex(p.accent)) {
    t.accent = hex(p.accent)!;
    t.accentContent = "#ffffff";
  }
  if (hex(p.neutral)) t.neutral = hex(p.neutral)!;
  if (hex(p.background)) t.base100 = hex(p.background)!;
  return Object.keys(t).length ? t : null;
}

/** daisyUI のテーマ変数を上書きする <style>（daisyUI CSS の後に置く）。
 *  CDN 構成では @plugin が使えないため、CSS 変数を直接上書きする。 */
function buildThemeStyle(theme?: DaisyTheme | null): string {
  if (!theme) return "";
  const v: string[] = [];
  const set = (name: string, val?: string) => {
    const h = hex(val);
    if (h) v.push(`--color-${name}:${h};`);
  };
  set("primary", theme.primary);
  set("primary-content", theme.primaryContent);
  set("secondary", theme.secondary);
  set("secondary-content", theme.secondaryContent);
  set("accent", theme.accent);
  set("accent-content", theme.accentContent);
  set("neutral", theme.neutral);
  set("neutral-content", theme.neutralContent);
  set("base-100", theme.base100);
  set("base-200", theme.base200);
  set("base-300", theme.base300);
  set("base-content", theme.baseContent);
  set("info", theme.info);
  set("info-content", theme.infoContent);
  set("success", theme.success);
  set("success-content", theme.successContent);
  set("warning", theme.warning);
  set("warning-content", theme.warningContent);
  set("error", theme.error);
  set("error-content", theme.errorContent);
  if (theme.radius && /^[0-9.]+rem$/.test(theme.radius)) {
    v.push(
      `--radius-field:${theme.radius};`,
      `--radius-box:${theme.radius};`,
      `--radius-selector:${theme.radius};`,
    );
  }
  if (theme.depth === 0 || theme.depth === 1) v.push(`--depth:${theme.depth};`);
  if (!v.length) return "";
  return `<style>:root,[data-theme="light"]{${v.join("")}}</style>`;
}

/** 構造化プロトタイプの単一HTMLを組み立てる（常に valid な完全HTMLを返す）。 */
export function buildDsHtml(opts: DsBuildOptions): string {
  const runtime = buildRuntime(opts);
  const theme = opts.theme ?? paletteToTheme(opts.brand?.palette);
  const themeStyle = buildThemeStyle(theme);
  // 生成済み画面の検知（済/未バッジ・「生成された画面」一覧）に使う @screen マーカー。
  // DS は React ルーターだが、保存HTMLにマーカーを残してモノリシックと同じ検知に揃える。
  // 生成に失敗した画面（プレースホルダ）は @screen に加えて @screen-failed も出し、
  // クライアント側で「済」ではなく「失敗」として扱えるようにする。
  const screenMarkers = opts.screens
    .map((s) =>
      s.failed
        ? `<!-- @screen:${s.label} -->\n    <!-- @screen-failed:${s.label} -->`
        : `<!-- @screen:${s.label} -->`,
    )
    .join("\n    ");
  return `<!DOCTYPE html>
<html lang="ja" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(opts.projectName || "プロトタイプ")}</title>
    <link href="${CDN.daisyui}" rel="stylesheet" type="text/css" />
    ${themeStyle}
    <script src="${CDN.tailwind}"></script>
    <script src="${CDN.react}"></script>
    <script src="${CDN.reactDom}"></script>
    <script src="${CDN.babel}"></script>
  </head>
  <body>
    <div id="root"></div>
    ${screenMarkers}
    <script type="text/plain" id="ds-src">
${runtime}
    </script>
    <script>
      (function () {
        try {
          var src = document.getElementById("ds-src").textContent;
          // 自動JSXランタイム（import 注入）を避け、classic（React.createElement）で変換する。
          var out = Babel.transform(src, {
            presets: [["react", { runtime: "classic" }]],
          }).code;
          var s = document.createElement("script");
          s.textContent = out;
          document.body.appendChild(s);
        } catch (e) {
          document.getElementById("root").innerHTML =
            '<div class="alert alert-error m-4">プレビューの初期化に失敗しました: ' +
            ((e && e.message) || e) +
            "</div>";
        }
      })();
    </script>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
