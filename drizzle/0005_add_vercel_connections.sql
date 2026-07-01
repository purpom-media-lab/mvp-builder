-- 2026-06-30: Vercel OAuth 連携（ユーザー所有アカウントへの公開）の per-user トークンを保存する
--             vercel_connections テーブルを追加。
-- 背景: 共有トークン1個（VERCEL_TOKEN）＝全MVPがビルダーの Vercel に公開される状態から、
--       各ビルダー利用者が自分の Vercel に公開できる per-user トークン（OAuth）方式へ移行する。
-- 構造: owner_id(PK=Better Auth user.id) / access_token_enc(AES-256-GCM 暗号化) /
--       team_id / installation_id(configurationId) / vercel_user(表示用) / timestamps
-- セキュリティ: access_token は平文で保存しない。暗号化は src/lib/crypto.ts（鍵は BETTER_AUTH_SECRET 由来）。
--
-- 適用: 通常はスキーマ変更を `pnpm db:push` で反映できる。
--       このファイルは単独でも実行可能（冪等）。本番適用前に必ず内容を確認すること。

BEGIN;

CREATE TABLE IF NOT EXISTS "vercel_connections" (
  "owner_id" text PRIMARY KEY NOT NULL,
  "access_token_enc" text NOT NULL,
  "team_id" text,
  "installation_id" text,
  "vercel_user" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

COMMIT;
