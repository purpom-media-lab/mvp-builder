-- 2026-06-26: projects に「詳細(intake)」と「分析結果」を別カラムで持たせる。
-- 背景: JTBD(ジョブ理論)等の背景処理が生成する分析結果と、ユーザー手入力の詳細が
--       projects.summary / source_documents(type=text) で混在し上書きしていた。
-- 方針: projects.detail = ユーザー入力の詳細(intake)、projects.analysis_result = 分析結果。
--       source_documents は URL/PDF の参考資料専用にする。
--
-- 適用: 通常はスキーマ変更(列追加)を `pnpm db:push` で反映できる。
--       このファイルは列追加＋既存データのバックフィルまで自己完結で行うため、
--       Neon に対して直接実行してもよい（冪等）。本番適用前に必ず内容を確認すること。

BEGIN;

-- 1) 列追加（冪等）
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "detail" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "analysis_result" text;

-- 2) バックフィル: 既存の手入力テキスト(source_documents.type='text')を projects.detail へ移設。
--    detail が未設定のものだけ移す（多重実行に安全）。
UPDATE "projects" p
SET "detail" = sd."raw_text"
FROM "source_documents" sd
WHERE sd."project_id" = p."id"
  AND sd."type" = 'text'
  AND (p."detail" IS NULL OR p."detail" = '');

-- 3) source_documents を URL/PDF 専用にする: 移設済みの text 行を削除。
--    ※ この DELETE は不可逆。上の UPDATE で detail へ退避済みであることを前提とする。
DELETE FROM "source_documents" WHERE "type" = 'text';

COMMIT;
