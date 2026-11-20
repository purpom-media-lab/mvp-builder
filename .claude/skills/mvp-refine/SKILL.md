---
name: mvp-refine
description: 稼働中の既存システム（BlackSwan・PML AI など）の改修・追加開発のモックと Figma を作る。まず既存の画面・メニュー・データモデル・テーマを 13 工程と同じ形に読み込み（baseline）、その上で要望に関係する画面だけを作る。「既存システムのモック」「改修のモック」「追加開発の画面案」「BlackSwan の画面案」「baseline を作って」「mvp-refine」などで使う。新規の事業アイデアからなら mvp-pipeline を使う。
---

# 既存システムの改修モード（mvp-refine）

設計: `docs/design/existing-system-refine.md`。新規モード（`mvp-pipeline`）の工程・スキーマ・
プロトタイプの組み立てをそのまま使い、**既存システムの読み込み（baseline）**と**差分だけ作る**部分を足したもの。

いま使えるのは段取り 1（baseline）まで。影響の判定・モック・Figma は段取り 2〜3 で足す。

## プロファイル

既存システムごとの設定は `profiles/<id>.json`。

| id | システム | UI |
| --- | --- | --- |
| `blackswan-web` | BlackSwan Web（blackswan-web） | MUI |

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
