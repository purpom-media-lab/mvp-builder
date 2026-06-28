-- 2026-06-28: market 工程（市場・競合分析）の成果物を保存する projects.market_analysis を追加。
-- 背景: Lean Quest AI に市場規模(TAM/SAM/SOM)・競合マップ・参入余地を生成する market 工程を新設。
--       1プロジェクト1件のため、独立テーブルにせず projects 直下に jsonb で持つ（growth_plan と同方針）。
-- 構造: { marketSize{tam,sam,som,assumptions}, trends[], positioning{xAxis,yAxis},
--         competitors[{name,type,description,strengths,weaknesses,x,y}], whitespace, differentiation }
--
-- 適用: 通常はスキーマ変更を `pnpm db:push` で反映できる。
--       このファイルは単独でも実行可能（冪等）。本番適用前に必ず内容を確認すること。

BEGIN;

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "market_analysis" jsonb;

COMMIT;
