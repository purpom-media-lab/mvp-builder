---
name: mvp-pipeline
description: 事業アイデア・要件資料から、OOUI分析〜設計の13工程（アクター/ユースケース/ジャーニー/市場/OOUI/ナビ/ワイヤー/データ設計/バックエンド/スコープ/KPI/グロース/ブランド）を専門ロールのサブエージェントで並列実行し、構造化された成果物を出力する。MVP Builder（Webアプリ）と同じプロンプト・同じスキーマを使う。「MVPの分析をして」「OOUI分析して」「この資料からMVPを設計して」等で使う。
---

# MVP パイプライン（Claude Code 版）

MVP Builder（`src/lib/ai/`）の分析・設計パイプラインを Claude Code で回す。
工程プロンプトとスキーマは `src/lib/ai/step-specs.ts` から機械生成されているので、
**Web アプリ本体と同じ品質・同じ出力形**になる。

## 成果物の置き場所

```
.mvp/<project-slug>/
├── input/            # 入力資料（PDF/テキスト/URL の控え）
├── project.json      # 名前・概要・ジョブ分析（JTBD）
└── artifacts/        # actors.json … brand.json（13ファイル）
```

`<project-slug>` は英小文字・ハイフンで短く（例: `.mvp/lead-crm`）。
以下、このディレクトリを `<projectDir>` と呼ぶ。

## 手順

### 1. 入力を揃える

- PDF は Read でそのまま読む。URL は WebFetch。テキストはそのまま受け取る。
- 資料の控えを `<projectDir>/input/` に保存する（後で再現・差分確認に使う）。

### 2. ジョブ分析（JTBD）— 対話で確定させる

いきなり分析に入らない。ジョブ理論の枠組みで**ユーザーと対話して要望を深掘りする**。

- 誰が、どんな状況で、何を片付けたくてこのプロダクトを「雇う」のか
- 今はどう代替しているか（既存の手段・回避策）、その何が不満か
- それが解決されたらどう嬉しいか（機能ではなく成果で）

不明点があれば必ず質問する。推測で埋めない。**曖昧なまま先に進むと13工程すべてが薄くなる。**
資料が十分に具体的で確認事項が無い場合のみ、この対話を省いてよい。

合意した内容を `<projectDir>/project.json` に書く。

```json
{
  "name": "プロダクト名",
  "summary": "1-2文の概要",
  "analysisResult": "ジョブ分析（JTBDインタビューでユーザーと合意した確定要望）の本文",
  "sourceText": "入力資料の要約または全文（長ければ要約）"
}
```

> `analysisResult` は**入力資料より優先される確定要望**として全工程が参照する。
> 矛盾したときはこちらを正とする。

### 3. 13工程をウェーブ並列で実行

`references/waves.md` を読み、そこに書かれたウェーブ順で実行する。

- **同一ウェーブ内の工程は 1 メッセージで同時に Task を発行する**（並列実行）。逐次にしない。
- 各 Task の `subagent_type` は `mvp-<step>`（例: `mvp-ooui`）。
- 各 Task に渡すプロンプトは `<projectDir>` を伝えるだけでよい。工程の指示はエージェント定義側にある。

  ```
  projectDir = .mvp/lead-crm
  この工程を実行して artifacts/<step>.json を書き出してください。
  ```

- 次のウェーブに進む前に、そのウェーブの成果物を検証する（次項）。

### 4. ウェーブごとに検証する

```bash
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/validate.ts <projectDir> <step> [<step> ...]
```

- `OK` なら次のウェーブへ。
- `INVALID` なら、**そのエージェントに SendMessage で**エラー出力をそのまま渡して直させる
  （新しい Task を立てない。文脈を持ったまま直すほうが速く正確）。
- 2 回直しても通らなければ、そこで止めてユーザーに報告する。勝手に手で JSON を書き換えない。

### 5. 報告

全ウェーブ完了後、`validate.ts` を引数なしで実行して13件すべて `OK` を確認し、
次を短くまとめて報告する。

- MVP ステートメント（`scope.json` の `mvpStatement`）
- OOUI のメインオブジェクトとナビゲーション構成
- MVP に含む機能（`includedInMvp` が true のもの）と、外したものの理由
- 北極星指標

成果物の JSON 本体は貼らない。ファイルパスを示す。

## 単一工程だけ回す

要望や修正で一部だけ作り直すとき:

1. 対象工程を決める。依存の下流（`references/waves.md` で後のウェーブにある工程）も
   内容が変わるなら一緒に作り直す。
2. 該当の `mvp-<step>` エージェントを起動する。
3. 検証する。

## 注意

- `.claude/agents/mvp-*.md` と `references/schemas/*.json` は**自動生成**。直接編集しない。
  プロンプトを変えるときは `src/lib/ai/step-specs.ts` を直して `pnpm gen:skill` を実行する
  （Web アプリ本体にも同じ変更が反映される）。
- 工程の実行順を勝手に変えない。ウェーブ順には根拠がある（`references/waves.md` 末尾）。
- `.mvp/` はコミットしない（`.gitignore` 済み）。
