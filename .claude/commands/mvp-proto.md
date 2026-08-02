---
description: MVP パイプラインのプロトタイプ（単一HTML）を生成／部分再生成する
argument-hint: <projectDir> [画面名 ...]
---

`mvp-pipeline` スキルの「6. プロトタイプを生成する」手順を実行してください。
先に `.claude/skills/mvp-pipeline/references/prototype.md` を読むこと。

指定: $ARGUMENTS

- 画面名を省略したら全画面を生成する。指定したらその画面だけ作り直し、他は既存を再利用する。
- `plan-screens.ts` → `mvp-screen`（画面数ぶんを**1メッセージでまとめて起動**）→ `assemble.ts` の順。
  テーマ生成が必要と出ていれば `mvp-theme` も同じメッセージに入れる。
- `assemble.ts` が「未生成」「壊れている」と報告した画面は、表示されるコマンドで
  その画面だけ作り直す。**失敗 0 になるまで繰り返す。**
- 13工程の成果物（`artifacts/*.json`）が揃っていない場合は、先にそちらを実行するか
  ユーザーに確認する。勝手に分析工程を回さない。
- 完了したら `<projectDir>/prototype/index.html` のパスと、画面数・失敗数を報告する。
