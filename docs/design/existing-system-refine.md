# 既存システムの改修モード（refine）— 設計

作成: 2026-11-20 / 状態: 案（未実装）

## 1. ゴール

MVP Builder は今、**新規の事業アイデア**から 13 工程 → プロトタイプ → Figma を作る。これを、
**稼働中の既存システム（BlackSwan・PML AI など）の改修・追加開発**にも使えるようにする。

- 入力: 既存システムの要望 1 件（Linear のイシュー・顧客バックログ・文章）
- 出力: 変わる画面と新しい画面だけのモック（HTML）と Figma（既存ファイルの部品で組む）、画面の差分表
- 実行主体: まず Claude Code（`/mvp-refine`）。最終的には PML AI の「UI の検討が要る」タスクから起動する

### 決めたこと（2026-11-20 青木さん）

| 論点 | 決定 |
| --- | --- |
| 置き場所 | Claude Code 版を先に作る。最終的には PML AI の中で、UI の検討が要るタスクから使えるようにする |
| 最初の対象 | BlackSwan の Web（MUI） |
| 見た目 | Figma を中心に本物へ寄せる。Figma は既存ファイルの部品で組み、HTML のモックは daisyUI に対象システムの色・フォントを当てる程度にとどめる |
| 対象システム | BlackSwan に限らない。PML AI など、既存システムなら何でも足せる形にする |

### 非ゴール

- 本番コードの生成（モックと Figma まで。実装は各リポジトリの通常の開発で行う）
- HTML のモックを MUI / Flutter で作り直すこと
- Web 版（Studio）への組み込み（Phase 4 以降）

## 2. 新規モードとの違い

| | 新規（今の `/mvp-run`） | 改修（`/mvp-refine`） |
| --- | --- | --- |
| 出発点 | 白紙 | 既存システムの画面・データ・デザイン |
| 13 工程 | 全部回す | 要望に関係する工程だけ（`mvp-orchestrate` の考え方を使う） |
| 画面 | 全画面を作る | **変わる画面と新しい画面だけ**。変わらない画面は既存のものを参照する |
| 見た目 | ブランド工程で決める | 対象システムのテーマを使う（ブランド工程は回さない） |
| Figma | プラグインが部品を新しく描く | Figma MCP（`use_figma`）で**既存ファイルの部品**を使い、専用ページに置く（ブランチは Organization プラン以上で、今の Pro では使えない） |
| 成果物 | 新しいプロダクトの設計一式 | 画面の差分表（追加・変更・削除）＋モック＋Figma の URL |

## 3. システムごとの「プロファイル」

既存システムごとの違いはプロファイル（設定ファイル 1 つ）に閉じ込め、パイプライン本体は共通にする。

```
.claude/skills/mvp-refine/profiles/
├── blackswan-web.yaml
└── pml-ai.yaml
```

```yaml
# profiles/blackswan-web.yaml（例）
id: blackswan-web
name: BlackSwan Web
repo: ~/claudecode/dev/prj-blackswan/blackswan
ui_stack: mui                       # mui | daisyui | flutter-m3
sources:
  screens: docs/analysis/screen-inventory.md#1-webblackswan-web   # 画面一覧
  pages_dir: apps/blackswan-web/src/pages                        # 画面の実体
  datamodel: packages/backend/schema.prisma                      # データモデル
  theme: apps/blackswan-web/src/theme/core/palette.ts            # 色・フォント
figma:
  file_key: iYY6Uo3lcvr8tAqPYiPZ1b  # ブラックスワン_Web（MW6.0）
  output: page                      # page（専用ページ）| branch（Figma のブランチ。Organization 以上）
requests:                           # 要望の入口
  linear_team: BlackSwan
  notion_backlog: BSB
```

```yaml
# profiles/pml-ai.yaml（例）
id: pml-ai
name: PML AI
repo: ~/claudecode/dev/prj-pml-ai/pml-ai
ui_stack: daisyui                   # 既存のモックの部品の組み方がそのまま合う
sources:
  ooui: docs/ooui.md                # OOUI 分析が既にある
  pages_dir: src/pages
  datamodel: migrations/
  mock: mock/index.html
figma:
  file_key: null                    # Figma が無ければ、今のプラグインと同じ書き出し方で新しく作る
requests:
  linear_team: PML MVP Tech（共通技術課題）
```

## 4. 流れ

```
要望 ──┐
       ▼
① 既存の把握（baseline） … プロファイルの sources から、画面一覧・ナビ・データモデル・OOUI・テーマを
       │                     13 工程の成果物と同じ形（navigation / datamodel / ooui / wireframe）に起こす。
       │                     システムごとに 1 回作って .mvp/<profile>/baseline/ に置き、ソースが変わったら作り直す
       ▼
② 影響の判定 … 要望と baseline から「再実行する工程」と「追加・変更・削除する画面」を決める（mvp-orchestrate を流用）
       │          → screen-diff.json（画面ごとに add / change / remove と理由）
       ▼
③ 設計の差分 … 必要な工程（usecases・ooui・navigation・datamodel・wireframe）だけを baseline の上で回す
       ▼
④ モック（HTML） … 対象画面だけ mvp-screen で生成。変わらない画面は baseline のワイヤーから簡易表示。
       │             テーマはプロファイルの theme から daisyUI テーマを作る
       ▼
⑤ Figma … use_figma で既存ファイルの部品（search_design_system で探す）を使って対象画面を組む。
       │       変更画面は既存画面を複製して直す。専用ページ（「改修案 / <イシュー> …」）に置き、既存のページには書かない
       ▼
⑥ 返す … 画面の差分表・モックの URL・Figma の URL を Linear のイシュー（または PML AI のタスク）にコメントする
```

### 新規モードから流用するもの

- 工程の定義・スキーマ（`step-specs.ts` → 自動生成のエージェント）
- `mvp-orchestrate`（要望 → 再実行工程）
- 画面生成（`mvp-screen`）と組み立て（`assemble.ts` / `buildDsHtml`）
- テーマのスキーマ（`themeSchema`）

### 新しく作るもの

| もの | 中身 |
| --- | --- |
| `/mvp-refine` コマンドと `mvp-refine` スキル | 上の ①〜⑥ の手順 |
| プロファイル 2 つ | `blackswan-web.yaml` / `pml-ai.yaml` |
| `mvp-baseline` エージェント | ① の起こし。画面一覧・ページの実体・データモデルを読み、成果物の形に変換する |
| `screen-diff` のスキーマ | ② の出力 |
| `theme-from-source.ts` | MUI の palette / daisyUI のテーマから、モック用の daisyUI テーマを作る |
| `mvp-figma-refine` エージェント | ⑤。既存の Figma の部品を使って画面を組む（`/figma-use` スキルに従う） |

## 5. 段取り

| Phase | 内容 | 終わりの条件 |
| --- | --- | --- |
| 1 | BlackSwan Web の baseline（①）とプロファイル | Web の全画面が navigation / wireframe の形で起こせる |
| 2 | 影響の判定とモック（②〜④） | 実際の要望 1 件（BS のイシュー）から、変わる画面だけのモックができる |
| 3 | Figma（⑤）と返却（⑥） | 同じ要望で、ブラックスワン_Web の Figma の専用ページに画面ができ、Linear にコメントが付く |
| 4 | PML AI のプロファイル | PML AI の要望 1 件で同じことができる |
| 5 | PML AI から起動 | PML AI のタスクで「UI の検討」を選ぶと、pml-agent が Mac で `/mvp-refine` を回し、結果がタスクに戻る |
| 6 | Studio（Web 版）への組み込み | 必要になったら |

## 6. 未決・確認すること

- ~~**Figma への書き込み先**~~: 専用ページに決定（2026-11-21）。所属チームはどれも Pro で、ブランチ（Organization 以上）は使えない
- **Figma の部品の状態**: ブラックスワン_Web の部品がライブラリとして公開されているか。されていなければ、既存画面のフレームを複製して使う
- **試す要望**: Phase 2 の検証に使う BlackSwan のイシューを 1 件決める
- **PML AI 側の入口**: タスクに「UI の検討が要る」をどう持たせるか（ラベルか、種別か）。Phase 5 の前に PML AI 側で決める
- MVP Builder の MCP は今、認証エラーになっている。Web 版の DB に書き戻す（`/mvp-push`）なら、トークンを直す必要がある
