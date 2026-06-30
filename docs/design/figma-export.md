# Figma エクスポート機能 設計（Approach B）

Lean Quest AI が生成したワイヤー＋ブランドを、ユーザーがアプリ内操作で **Figma デザインに書き出す**機能の設計。
PoC（[実ファイル](https://www.figma.com/design/JVpK9lNWtOkDWnGAjmY3es)）で全 screenType / section type / テーマ（light 3案＋dark）が Figma に成立することを実証済み。本書はそれを製品機能として正式化する。

## 1. 背景と技術制約（最重要）

- Figma の**公開 REST API はキャンバス内容に対して読み取り専用**。フレーム/レイヤー/コンポーネントを**サーバから直接生成できない**。
- 設計をFigmaに“描き込む”には **Figma Plugin API（Figma 内で動くコード）** が必須。
- → よって本機能は **「アプリの書き出しエンドポイント」＋「Lean Quest Figma プラグイン」** の二者構成にする。サーバ単独・ボタン一発で完結する形は公式APIでは不可能。

## 2. 全体アーキテクチャ

```
[Studio: デザイナー連携パネル]
   └─「Figmaに書き出す」→ POST /api/export/figma/:projectId
         ├─ getProjectWithArtifacts から ExportBundle(JSON) を生成
         └─ export_token を発行（短命）＋ designRequests を更新
                              │
                    ユーザーが Figma で
                    [Lean Quest プラグイン] を起動
                              │
   プラグイン ── GET /api/export/figma/:projectId?token= ──→ ExportBundle
        └─ ビルダー（PoCのレシピを移植）が
            Variables/Styles/Components → 画面フレームを生成
        └─ 生成後 file_url を POST /api/export/figma/:projectId/callback
                              │
        designRequests.figmaUrl に保存（既存カラムを再利用）
```

- 既存資産との接続：`designRequests` に既に `deliverable:"figma"` と `figmaUrl` がある。
  「デザイナーが Figma URL を貼る」フローを「**こちらが生成して figmaUrl を埋める**」に置き換える。

## 3. ExportBundle（書き出し契約 / 安定JSON）

アプリが emit する唯一の契約。実体は `wireframes` + `brand` + `navigation` の薄い変換。

```ts
interface ExportBundle {
  meta: { projectId: string; productName: string; generatedAt: string };
  brand: {
    light: ThemeTokens;            // HEX。brand.palette から
    dark: ThemeTokens;             // light から導出（base/contentを反転）
    paletteOptions: { name: string; tokens: ThemeTokens }[]; // 3案（brand.paletteOptions）
    typography: { heading?: string; body?: string };
  };
  navigation: { label: string; targetObject: string|null; screenType: string; parent: string|null; icon: string|null }[];
  screens: {
    screenName: string;
    screenType: "dashboard"|"list"|"detail"|"form"|"other";
    layoutPattern: "stack"|"master-detail"|"grid"|"single"|null;
    targetObject: string|null;
    sections: { type: SectionType; label: string; items: string[]|null }[];
  }[];
}
// ThemeTokens: { primary, secondary, accent, neutral, base100, base200, base300, content }
// SectionType: header|toolbar|kpi|chart|table|list|cards|calendar|map|timeline|form|detail|sidebar|footer|other
```

## 4. section → Figma マッピング仕様（PoCで実証済み）

各 section.type を Figma の Auto Layout ノード構成へ写す。すべて「レイアウト用フレームは `fills=[]`、塗りはカード/入力/ボタン/背景のみ」を厳守（dark での白帯防止）。

| section.type | Figma 構成 | 使うブランドトークン |
|---|---|---|
| （シェル） | drawer 風 sidebar(base-100) ＋ navbar(base-100) ＋ content(base-200) | primary（active）, content |
| `header` | タイトル(20-22 Bold) ＋ サブ(13, .6) ＋ 右アクション | content |
| `toolbar` | search input ＋ 複数 select ＋ 右に primary ボタン（space-between） | base-300 border, primary |
| `kpi` | stat カード（label 11 / value 24 Bold / delta）を FILL 等分の row | base-100, accent/green/gray(delta) |
| `chart` | 棒グラフ＝rect の bottom 揃え row／パイプライン帯＝ステージ別 mini カード | primary, accent, ステータス色 |
| `table` | カード内 thead(base-200)＋zebra rows。badge列は値で色分け | base-100/200, ステータス/確度色 |
| `list` | li（title/sub ＋ 右 badge）の縦積み | content, status色 |
| `timeline` | 色ドット ＋ (件名 ＋ 種別×日時) の row | 活動種別色 |
| `calendar` | 曜日ヘッダ ＋ 7×N 日セル(border)。過去は淡色、タスクは chip | base-300, status色 |
| `form` | fieldset = label(13,.7) ＋ input/select/toggle。区切りに 1px divider | base-300, primary(toggle on) |
| `detail` | header card に KV グリッド(2-4列) ＋ アクション行 | base-100, badge色 |
| `cards` | カードグリッド（grid 集約。bento 可） | base-100 |
| `map` | プレースホルダ枠（地図SDK外）＋ピン表現 | base-200 |

`layoutPattern`: `stack`→画面遷移単位の縦積み / `master-detail`→2ペイン / `grid`→ダッシュボード集約 / `single`→単一フォーム。

## 5. テーマ・コンポーネント戦略（製品版での格上げ）

PoC は生の塗りで描いた。製品版では：

1. **Figma Variables 化**：`LeadFlow/Theme` コレクションに modes = `Light` / `Dark`、変数 `primary/secondary/accent/neutral/base-100/200/300/content` を定義し、フレームの塗りを変数バインド。→ Figma上でモード切替＝テーマ切替が機能する。`paletteOptions`（3案）は別 mode か別コレクションで出し分け。scopes は `FRAME_FILL/SHAPE_FILL`・`TEXT_FILL` 等を明示。
2. **コンポーネント化**：daisyUI MCP の正確なクラス構成を元に `Button / Badge / Input / Select / Toggle / Card / NavItem / TableRow / StatCard` を**Variant付きで一度だけ作成**し、各画面はインスタンスを配置（`figma-generate-library` ワークフロー）。差し替え・一括変更が効く。
3. **テキストスタイル**：見出し/本文ランプを `brand.typography` から生成（日本語は Noto Sans JP）。

## 6. プラグイン内部

- 認可：プラグインから app への OAuth もしくは個人APIキー。MVP は「Studio で発行した短命 export_token を貼る」で簡素化。
- ビルド：PoC のヘルパー（`hex/solid/col/row/T/field/sel/btn/badge/card/cell/...`）と画面レシピをそのまま移植。Plugin API ルール厳守：
  - `loadFontAsync` → `await` → mutate、色 0–1、`layoutSizing*='FILL'` は appendChild 後、`resize()` はサイジングモード前、レイアウトフレーム `fills=[]`。
  - 大画面は**インクリメンタル**（skeleton → セクション順次、`placeholder` shimmer）。1スクリプト ≤ 10論理操作。
  - エラーは atomic（未実行）→ メッセージを読んで修正、即リトライしない。
- 検証：各画面 `screenshot()` で目視（dark の白帯・白文字消えに注意）。

## 7. フェーズ計画

| Phase | 内容 | 目安 |
|---|---|---|
| **0（完了）** | エージェント駆動 PoC（全画面＋4テーマ）で成立を実証 | done |
| **1（MVP）** | `/api/export/figma` ＋ プラグイン（生ノードで PoC 同等の画面生成・light）。Studio に「Figmaに書き出す」ボタン、`figmaUrl` 反映 | ~1–2週 |
| **2** | Figma Variables（light/dark＋3案）＋コンポーネントライブラリ化＋テーマ切替 | ~1–2週 |
| **3** | 既存ファイルへの更新/同期、Code Connect、designBrief 連携の磨き込み | 適宜 |

## 8. UX（Studio 配置）

- 置き場所：**デザイナー連携パネル**（`designRequests`／`deliverable:figma` の既存導線）。
- ボタン：「🎨 Figmaに書き出す」→ モーダルで (a) 対象画面の選択（全画面/一部）、(b) テーマ（light＋採用パレット/dark/both）、(c) export_token とプラグイン起動手順を表示。
- 生成完了後：`figmaUrl` をパネルに表示（「Figmaで開く」）。

## 9. リスク / オープン課題

- **プラグイン配布**：組織内プライベート公開 or Community 審査。MVP は dev-mode/組織内で十分。
- **認可**：プラグイン↔app のトークン受け渡し設計（短命トークン＋プロジェクト所有者検証）。
- **マッピング保守**：`wireframeSchema` の section enum 追加時にマッピングを追従（本表を単一の真実源にする）。
- **フォント**：日本語 Noto Sans JP の実在確認（`listAvailableFontsAsync`）。
- **大規模画面の生成時間/上限**：インクリメンタル分割で回避。
- **map/cards**：当該ドメイン未出現。map は地図SDK外のためプレースホルダ表現に留める。

## 10. 受け入れ条件（Phase 1）

- Studio から「Figmaに書き出す」で、対象プロジェクトの list/detail/dashboard/form 画面がブランド配色で Figma に生成される。
- 生成された Figma ファイル URL が `designRequests.figmaUrl` に保存され、パネルから開ける。
- 所有者以外のプロジェクトは書き出せない（token＋所有権検証）。
