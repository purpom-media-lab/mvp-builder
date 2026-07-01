# Vercel OAuth 連携で「ユーザー所有アカウントに公開」

各ビルダー利用者が **自分の Vercel アカウント/チーム** を連携し、生成した MVP（静的フロント）を
**自分の Vercel** にデプロイできるようにする（v0 / Bolt の "Deploy to your Vercel" と同型）。

現状は共有トークン1個（`VERCEL_TOKEN`）＝全MVPがビルダーの Vercel に公開される。本設計で
**per-user トークン（OAuth）** に切り替える。

## 1. 全体フロー（Vercel Integration OAuth）

```
[Studio] 「Vercelを連携」
  → GET /api/integrations/vercel/connect        (state発行→Cookie保存)
  → 302 https://vercel.com/integrations/<slug>/new?state=...   (ユーザーが team を選んで承認)
  → 302 戻り: GET /api/integrations/vercel/callback?code=...&configurationId=...&teamId=...
       - state 検証
       - POST https://api.vercel.com/v2/oauth/access_token
           {client_id, client_secret, code, redirect_uri}
         → { access_token, team_id, installation_id, user_id }
       - access_token を **暗号化して per-user 保存**（vercel_connections）
  → 設定画面へ戻る（連携済み表示）

[公開時] 「Vercelに公開」
  → publish は env の共有トークンではなく **その利用者の connection.access_token / team_id** を使用
  → 自分の Vercel アカウント/チームにデプロイ（保護解除も同トークンで）
```

## 2. 事前準備（ユーザー＝あなたが Vercel 側で作る）

Vercel ダッシュボード → **Integrations → Console → Create** で Integration を作成し、以下を取得/設定：

- **Client ID** → env `VERCEL_OAUTH_CLIENT_ID`
- **Client Secret** → env `VERCEL_OAUTH_CLIENT_SECRET`
- **Slug**（インストールURL用）→ env `VERCEL_INTEGRATION_SLUG`
- **Redirect URL**（Integration 設定に登録）:
  - 本番: `https://<本番ビルダードメイン>/api/integrations/vercel/callback`
  - ローカル: `http://localhost:3000/api/integrations/vercel/callback`
- スコープ/権限: デプロイ作成・プロジェクト設定変更（保護解除）に必要な権限を付与。

> これらが揃うまで実装は「未設定＝連携ボタン無効」で安全に動く（既存の共有トークン公開はそのまま残せる）。

## 3. データモデル（新規テーブル）

`vercel_connections`（1 ビルダーユーザー = 1 行）
| カラム | 型 | 備考 |
|---|---|---|
| `owner_id` | text | Better Auth user.id（PK 兼） |
| `access_token_enc` | text | **AES-256-GCM 暗号化**（鍵は `BETTER_AUTH_SECRET` 由来。`iv:tag:cipher` 形式） |
| `team_id` | text | 連携先チーム（null=personal） |
| `installation_id` | text | configurationId |
| `vercel_user` | text | 表示用（ハンドル/メール） |
| `created_at` / `updated_at` | timestamp | |

- トークンは**平文で保存しない**。`src/lib/crypto.ts`（新規）に `encryptSecret`/`decryptSecret`（node:crypto AES-GCM）。
- 切断時は行削除（Vercel 側の uninstall API も任意で呼ぶ）。

## 4. エンドポイント（新規）

| ルート | 役割 |
|---|---|
| `GET /api/integrations/vercel/connect` | state 発行（署名Cookie）→ Vercel インストールURLへ 302 |
| `GET /api/integrations/vercel/callback` | code→token 交換、暗号化保存、設定画面へ戻す |
| `GET /api/integrations/vercel/status` | 連携状態（team 名等）を返す（UI 表示用） |
| `DELETE /api/integrations/vercel` | 連携解除（行削除） |

すべて **所有者セッション必須**。state は CSRF 対策（HMAC 署名 + 短命、`export-token.ts` の方式を流用可）。

## 5. 公開フローの改修

- `lib/handoff.ts` の `publishProject` を **トークン注入式**に変更：
  `publishProject({ projectName, html, vercel: { token, teamId } })`。
- `api/projects/[id]/publish` で、**現在のユーザーの `vercel_connections` を復号して渡す**。
  - 連携あり → ユーザーの Vercel に公開（＝所有アカウント）。
  - 連携なし → （任意）従来の共有 `VERCEL_TOKEN` にフォールバック、または「先に Vercel 連携が必要」を返す。
- 保護自動解除（`ssoProtection:null`）も**そのユーザーのトークン**で実行（自分のプロジェクトに対してのみ）。

## 6. UI

- 設定（または「ビルド」パネル）に **「Vercel連携」**セクション：
  - 未連携: 「Vercelを連携」ボタン → `/api/integrations/vercel/connect`
  - 連携済み: チーム名 + 「解除」ボタン
- 「Vercelに公開」ボタンは、未連携時に「先に Vercel を連携してください」を表示。

## 7. バックエンド/DB の扱い（重要）

- デプロイされるのは **フロント（静的HTML）**。
- **バックエンド（データ/認証）は引き続きビルダーの共有 Neon（BaaS）** を使う：
  - 公開HTMLに **ランタイムSDKを“ビルダーの絶対URL”で注入** ＋ `/api/run/*` に **CORS** を許可（別設計：図 figma-export と同様の方針）。
  - ＝「フロント=ユーザーのVercel / データ=ビルダー」。
- バックエンドまで完全にユーザー側へ移すのは別スコープ（重い）。

## 8. フェーズ

- **Phase 1**: テーブル＋暗号化＋ connect/callback/status/delete ＋ UI（連携できる）。公開は連携トークンで実行。
- **Phase 2**: 公開HTMLへの SDK 絶対URL注入＋ `/api/run/*` CORS（＝ユーザーVercel上のMVPでもデータ機能が動く）。
- **Phase 3**: 連携解除時の Vercel uninstall、複数チーム選択、デプロイ履歴/再デプロイ。

## 9. セキュリティ要点

- access_token は **AES-GCM 暗号化保存**・サーバ専用・ログ出力禁止。
- OAuth state で CSRF 防止。redirect_uri 完全一致。
- 保護解除はそのユーザーのプロジェクトに限定（他テナント不可）。
- 連携トークンは Vercel 側でいつでも失効可能（uninstall）。
