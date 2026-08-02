---
description: MVP パイプラインの特定工程だけを再実行する
argument-hint: <projectDir> <step> [追加の指示]
---

`mvp-pipeline` スキルの「単一工程だけ回す」手順で、指定された工程を再実行してください。

指定: $ARGUMENTS

- 工程キーは actors / usecases / journey / market / ooui / navigation / wireframe /
  datamodel / backend / scope / kpi / growth / brand のいずれか。
- 再実行した工程の**下流工程**（`references/waves.md` で後のウェーブにあるもの）が
  内容的に影響を受けるなら、どれを作り直すべきかを提示してから実行する。
- 実行後は必ず `validate.ts` で検証する。
