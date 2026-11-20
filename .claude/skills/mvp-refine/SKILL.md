---
name: mvp-refine
description: 稼働中の既存システム（BlackSwan・PML AI など）の改修・追加開発のモックと Figma を作る。まず既存の画面・メニュー・データモデル・テーマを 13 工程と同じ形に読み込み（baseline）、その上で要望に関係する画面だけを作る。「既存システムのモック」「改修のモック」「追加開発の画面案」「BlackSwan の画面案」「baseline を作って」「mvp-refine」などで使う。新規の事業アイデアからなら mvp-pipeline を使う。
---

# 既存システムの改修モード（mvp-refine）

設計: `docs/design/existing-system-refine.md`。新規モード（`mvp-pipeline`）の工程・スキーマ・
プロトタイプの組み立てをそのまま使い、**既存システムの読み込み（baseline）**と**差分だけ作る**部分を足したもの。

いま使えるのは段取り 1（baseline）・2（既存の検討の確認と、変わる画面の決定）・3（触れるモック）まで。Figma への書き出しは段取り 4 で足す（今は Figma MCP で手で描く）。

## プロファイル

既存システムごとの設定は `profiles/<id>.json`。

| id | システム | UI |
| --- | --- | --- |
| `blackswan-web` | BlackSwan Web（blackswan-web） | MUI |
| `blackswan-admin-web` | BlackSwan 管理画面（blackswan-admin-web） | MUI |

新しいシステムは `profiles/blackswan-web.json` を写して直す。項目の意味は `scripts/_profile.ts` の `Profile` 型。

## baseline の置き場所

```
.mvp/<profileId>/baseline/
├── sources.json            # どのコミットから作ったか（古さの判定に使う）
├── status.json             # baseline-merge の結果（件数・警告）
├── entities-index.json     # エンティティ名と日本語のコメント
├── screen-sources.json     # 画面名 → ページのソース
├── artifacts/
│   ├── navigation.json     # mvp-baseline-nav が書く
│   ├── wireframe.json      # baseline-merge が parts からまとめる
│   └── datamodel.json      # baseline-collect が機械で起こす
├── prototype/theme.json    # baseline-collect が機械で起こす（モック用 daisyUI テーマ）
├── prompts/                # エージェントへの指示（baseline-collect が作る）
└── parts/wireframe-<i>.json  # mvp-baseline-screens が書く
```

## 手順: baseline を作る・更新する

### 0. 古くなっていないか

```bash
pnpm exec tsx .claude/skills/mvp-refine/scripts/baseline-status.ts <profileId>
```

`FRESH` なら作り直さない。`STALE` は変わったファイルが出る。`NONE` / `BROKEN` は 1 から。

### 1. 機械でできる部分

```bash
pnpm exec tsx .claude/skills/mvp-refine/scripts/baseline-collect.ts <profileId>
```

対象リポジトリは**今チェックアウトされているブランチ**を読む。develop / main 以外のときは出力に出るので、
それでよいか確かめる（作業中のブランチを読むと、まだ入っていない画面が混ざる）。

### 2. ナビゲーション（1 体）

`mvp-baseline-nav` を起動する。渡すのは `baselineDir = .mvp/<profileId>/baseline` だけ。

### 3. 画面（batch 数ぶんを 1 メッセージで同時に）

ナビが書けてから、`baseline-collect` が出した batch 番号ぶん `mvp-baseline-screens` を**1 メッセージでまとめて**起動する。

```
baselineDir = .mvp/blackswan-web/baseline
batch = 3
```

> エージェント定義（`.claude/agents/mvp-baseline-*.md`）は Claude Code の起動時に読まれる。
> 足した直後のセッションで `subagent_type` に出てこないときは、汎用のエージェントに
> 「`.claude/agents/mvp-baseline-screens.md` を読んでその指示どおりに」と渡す。

### 4. まとめて検証

```bash
pnpm exec tsx .claude/skills/mvp-refine/scripts/baseline-merge.ts <profileId>
```

- `INVALID` は直す。batch の不足・スキーマ違反は、その batch のエージェントに SendMessage で出力を渡して直させる。2 回で直らなければ止めて報告する。
- `WARN` の「ナビにあるのにワイヤーが無い画面」は、多くは画面名の表記ゆれ。該当 batch を直させる。ナビの項目がページを持たない（外部リンク等）なら残してよい。
- 報告は件数（ナビ・画面・警告）とディレクトリだけ。JSON は貼らない。

## 手順: 要望（イシュー）のモックを作る

baseline が `FRESH` であることを先に確かめる（上の 0）。要望の作業は `.mvp/<profileId>/requests/<イシュー>/` に置く。

### 段取り 2-0. もう検討が進んでいないか（必ず最初に）

**作り始める前に、同じ要望のデザイン・モック・整理が既に無いかを確かめる。** 2026-11-21 の BS-8296 では、
前日に別のセッションが Figma の draft ページと社内メモを作っていたのに気づかず、仕様の古いモックを作り直した。

```bash
pnpm exec tsx .claude/skills/mvp-refine/scripts/existing-work.ts <profileId> <イシュー> [言葉 ...]
```

- 社内メモ（手元と **origin の最新**の両方）と、Figma の画面インデックスの draft を探す。exit 3 は見つかった
- スクリプトで見られないものは MCP で確かめる:
  - **Figma のページ名**: `get_metadata`（nodeId なし）でページ一覧を取り、イシューのキー・機能名を含むページを探す（インデックスに載る前の新しい draft のページはここでしか見つからない）
  - **イシューのコメント・関連イシュー**: Linear の `get_issue`（`includeRelations`）と `list_comments`。親・子のイシューも見る
- 見つかったら中身を読み、**ユーザーに「作り直す／それに合わせて触れる形にする／やめる」を確かめてから**先へ進む。合わせるときは、その draft の文言・データ・案の印をそのまま仕様に写す

### 段取り 2-1. 置き場所を作り、変わる画面を決める

```bash
pnpm exec tsx .claude/skills/mvp-refine/scripts/request-init.ts <profileId> <イシュー>
```

1. `project.json` の要約を書く（誰が・何のために・どこを変えるか）
2. `artifacts/navigation.json` を直す。**変わる画面と新しい画面だけを残す**（新しい画面を足し、関係の無い既存の画面は消す。入口になる既存の画面は残して「何を足すか」だけを仕様に書く）。`screenType: "list"` の画面には「◯◯詳細」が自動で足される。詳細が要らない一覧は `other` にする
3. 仕様の元を集める: イシュー本文、要件定義・基本設計（Notion）、課題管理表、2-0 で見つけた draft・メモ、baseline の `artifacts/wireframe.json`（既存の画面の作り）と Figma の master（見た目）
4. `spec/_common.md`（全画面に効く指示）と `spec/<画面名>.md`（画面ごと）を書く。書き方:
   - 列・項目・ボタン・ダイアログ・文言を**具体的に**並べる。モックデータの行も書く（架空の名前）
   - **決まっていないものは推測で決めず「（案）」の印**を指定する
   - 作らないもの（取りやめた機能など）も書く。書かないと mvp-screen が発明する

### 段取り 3. 触れるモックにする

```bash
pnpm exec tsx .claude/skills/mvp-refine/scripts/request-proto.ts <profileId> <イシュー> [画面名 ...]
```

- `plan-screens` を回し、各画面のプロンプトの末尾に `spec/` を足す。spec の無い画面があれば止まる
- 出力の画面番号ぶん `mvp-screen` を**1 メッセージで同時に**起動する（足した直後のセッションでは汎用のエージェントに「`.claude/agents/mvp-screen.md` を読んでその指示どおりに」と渡す）
- `pnpm exec tsx .claude/skills/mvp-pipeline/scripts/assemble.ts <requestDir>` で組み立てる（失敗 0 まで）
- `pnpm exec tsx .claude/skills/mvp-refine/scripts/pack-artifact.ts <profileId> <イシュー> --title "<名前>"` で claude.ai に出せる形（`prototype/artifact.html`）にする（daisyUI の CSS を埋め込み、CDN の版を固定）
- ブラウザで全画面を開き、コンソールのエラーと見た目を確かめる（Playwright は `file:` を開けないので `python3 -m http.server` で出す。終わったら止める）
- Artifact で publish する。同じ要望の 2 回目以降は**同じ file_path** で出す（URL が変わらない）
- 報告: URL・画面の一覧・案の印を付けたもの・仕様の元にしたもの（版数）・確かめていないこと

### 段取り 4. Figma（今は手で）

Figma の書き込みは共有ファイルなので**ユーザーの確認を取ってから**。プロファイルの `figma.output` が `page` なら、専用の draft ページ（例「<機能名>（draft・<イシュー>）」）を作り、master の画面（多くはコンポーネント）のインスタンスを置いて detach し、中を直す。master のページは変えない。手順は Figma MCP の figma-use・figma-generate-design。
