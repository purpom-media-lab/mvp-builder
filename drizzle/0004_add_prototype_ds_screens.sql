-- 2026-06-29: DSエンジンのプロトタイプ部分再生成を「非破壊マージ」にするため、
--             画面別ソースを保存する prototypes.ds_screens を追加。
-- 背景: 一部画面だけ選択して再生成すると、保存HTMLが選択画面だけに洗い替えられ、
--       既存の生成済み画面が消えていた。画面別ソースを保存しておけば、選択画面だけ
--       作り直し、残りはこの保存ソースを再利用して全画面のHTMLを再構築できる。
-- 構造: [{ label, componentName, source, failed, parent }]（1画面=1 React コンポーネント）。
--
-- 併せて prototypes.ds_theme（daisyUI テーマ）も追加。部分再生成ではテーマを作り直さず
-- 再利用して配色の一貫性を保ち、テーマ生成のLLM呼び出し（数十秒）を省く。
--
-- 適用: 通常はスキーマ変更を `pnpm db:push` で反映できる。
--       このファイルは単独でも実行可能（冪等）。本番適用前に必ず内容を確認すること。

BEGIN;

ALTER TABLE "prototypes" ADD COLUMN IF NOT EXISTS "ds_screens" jsonb;
ALTER TABLE "prototypes" ADD COLUMN IF NOT EXISTS "ds_theme" jsonb;

COMMIT;
