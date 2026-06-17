# MVP Builder

事業アイデア/要件を入力すると、**OOUI 分析 → UI 設計 → 動く MVP（クリック可能プロトタイプ）生成 → 公開 → 引き継ぎ**までを 1 つの UI で通す独立プロダクト。

## コアパイプライン

1. **入力** — 資料読込（PDF / URL / テキスト）
2. **分析（OOUI）** — アクター整理 → ユースケース書き出し → ユースケース図 → OOUI 分析（オブジェクト抽出）
3. **設計** — ジャーニー → ワイヤー → データ設計 → バックエンド要否判定（認証/ストレージ/DB）
4. **生成** — v0 Platform API でクリック可能な Next.js プロトタイプ生成 + iterate
5. **公開** — Vercel デプロイ + GitHub 引き継ぎ

## 技術スタック

| 領域         | 採用                                                          |
| ------------ | ------------------------------------------------------------- |
| Framework    | Next.js (App Router) / React 19                               |
| ホスティング | Vercel                                                        |
| DB           | Neon (Postgres) + Drizzle ORM                                 |
| 認証         | Clerk                                                         |
| AI 生成      | Vercel AI SDK（**Claude / OpenAI / Gemini を選択可能**）+ Zod |
| MVP 生成     | v0 Platform API (`v0-sdk`)                                    |
| 課金         | Stripe（後フェーズ）                                          |

### LLM プロバイダ切り替え

`src/lib/ai/models.ts` の `MODEL_CATALOG` に Claude / OpenAI / Gemini を定義。
UI/API から `provider`（`"claude" | "openai" | "gemini"`）と任意の `modelId` を渡すと
`resolveModel()` が AI SDK の LanguageModel を解決する。各工程は `src/lib/ai/steps.ts`。

## セットアップ

```bash
pnpm install
cp .env.example .env.local   # 各種キーを設定（DATABASE_URL, V0_API_KEY, 各LLMキー, Clerk）
pnpm db:push                 # Neon にスキーマを反映
pnpm dev                     # http://localhost:3000
```

## ディレクトリ

```
src/
├── app/                 # Next.js ルート
└── lib/
    ├── db/              # Drizzle スキーマ + Neon クライアント
    ├── ai/              # AI SDK（プロバイダ選択 / 構造化生成 / 工程別ジェネレータ）
    └── v0.ts            # v0 Platform API ラッパー
```
