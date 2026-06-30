# Lean Quest → Figma Export（Figma プラグイン）

Lean Quest AI が生成したワイヤー＋ブランド（ExportBundle）を Figma に画面として書き出すプラグイン。
Approach B / Phase 1（生ノード生成・選択テーマの塗り）。設計: [`../docs/design/figma-export.md`](../docs/design/figma-export.md)。

## 構成

| ファイル | 役割 |
|---|---|
| `manifest.json` | プラグイン定義（`main: code.js` / `ui: ui.html`） |
| `code.js` | 本体。ExportBundle を受け取り section→Figma マッピングで画面生成 |
| `ui.html` | 入力 UI（JSON ペースト or URL 取得、テーマ選択） |

ビルド不要（プレーン JS）。そのまま Figma に読み込める。

## 開発用に読み込む（Figma デスクトップ）

1. Figma デスクトップアプリを開く
2. メニュー → Plugins → Development → **Import plugin from manifest…**
3. この `figma-plugin/manifest.json` を選択
4. 任意の Figma **デザインファイル**を開き、Plugins → Development → *Lean Quest → Figma Export* を実行

## 使い方（Phase 1：JSON ペースト方式）

1. Lean Quest の Studio で対象プロジェクトの **ExportBundle JSON** を取得
   （`GET /api/export/figma/:projectId` の応答。将来は「Figmaに書き出す」ボタンがコピーを提供）
2. プラグインの「① ExportBundle JSON を貼り付け」にペースト
3. 「② テーマ」で light / dark / パレット案を選択
4. **Figmaに生成** → 各画面が横並びに生成される

> URL 取得欄は、エンドポイントが公開化／短命トークン認可される **Phase 2** で有効化（セッション認証のエンドポイントは CORS・Cookie の都合でプラグインから直接叩けないため、Phase 1 はペースト方式）。

## section → Figma マッピング

`code.js` の `RENDERERS` が section.type ごとの描画を担当（`docs/design/figma-export.md` の表が真実源）:

`header / toolbar / kpi / chart / table / list / timeline / form / detail / calendar(→table) / cards(→list) / map・footer・sidebar・other(→fallback)`

各画面はサイドバー（`navigation` から）＋ navbar ＋ コンテンツ（sections を順に描画）のアプリシェルで構成。
ブランドトークン（`ExportBundle.brand.light/dark/paletteOptions`）を塗りに適用する。

## 制限（Phase 1）/ 次の予定（Phase 2）

- Phase 1 は **生ノード＋ダミーデータ**（テーブル行などはサンプル値）。実データ埋め込みは対象外。
- Phase 2: **Figma Variables**（light/dark/3案のモード切替）＋ **コンポーネントライブラリ化**（Button/Badge/Card 等を Variant 化してインスタンス配置）。
- Phase 2: app 側の短命トークン認可＋ CORS で **URL 直接取得**を有効化。

## 検証メモ

`code.js` の helper / renderer / `buildScreen` は、全 section type を含む「レンダラ検証」画面を Figma Plugin API 上で生成して目視確認済み（header〜detail まで正しく描画、シェルのサイジングも崩れなし）。
