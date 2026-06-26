-- 2026-06-27: 実ユーザー（回答者）の声を蓄積する user_voices テーブルを追加。
-- 背景: 公開プロト(/run)に埋め込んだフィードバックウィジェットから、匿名の回答者ごとに
--       JTBD インタビューの全文と構造化サマリ(状況/ジョブ/代替/障壁/感想/成功基準)を貯める。
--       ビルダー本人用の chat_messages とは別物（所有者チェックなし・projectId 紐付け）。
-- 方針: projectId × respondent_id で 1 行を upsert し、毎ターン会話全文を上書きする。
--
-- 適用: 通常はスキーマ変更を `pnpm db:push` で反映できる。
--       このファイルは単独でも実行可能（冪等）。本番適用前に必ず内容を確認すること。

BEGIN;

CREATE TABLE IF NOT EXISTS "user_voices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "respondent_id" text NOT NULL,
  "messages" jsonb,
  "job_summary" jsonb,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "user_voices"
    ADD CONSTRAINT "user_voices_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 回答者ごとの upsert を高速化（projectId × respondent_id で絞り込む）。
CREATE INDEX IF NOT EXISTS "user_voices_project_respondent_idx"
  ON "user_voices" ("project_id", "respondent_id");

COMMIT;
