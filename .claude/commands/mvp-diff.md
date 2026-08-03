---
description: 本体（MVP Builder）の既存プロジェクトと Claude Code 版の出力を突き合わせる
argument-hint: <projectId | studio の URL> [projectDir]
---

`mvp-pipeline` スキルの「7. 検証モード」の手順を実行してください。

指定: $ARGUMENTS

- `projectDir` を省略したら `.mvp/diff-<プロジェクト名の英小文字スラッグ>` を使う。
- **本体の成果物を見たまま再分析させない。** `reference/` に隔離されたものを
  分析中に読まない（読むと「写す」だけになり比較にならない）。
- 13工程が終わってから `compare.ts` を実行し、その出力をもとに**差が出た理由**を
  短く論評する。どちらが妥当かの判定はスクリプトではなく Claude が行う。
- 環境変数 `MVP_BUILDER_MCP_URL` / `MVP_BUILDER_MCP_TOKEN` が要る。
  未設定ならユーザーに発行方法（ダッシュボードの「Claude Code 連携」）を案内して止まる。
  **トークンを応答本文に書かない。**
