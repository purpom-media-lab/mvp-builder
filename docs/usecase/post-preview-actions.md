# ユースケース: プレビュー完成後のアクション（公開 / ビルド / デザイン依頼）

プロトタイプ（プレビュー）が完成した後に行う 3 系統のアクションを整理する。
対象画面は `/studio/[id]/prototype`（および遷移先 `/studio/[id]/design-request`）。

共通の事前条件:
- ユーザーがログイン済みで、対象プロジェクトの所有者である。
- プレビュー（`prototypes.html` または `demoUrl`）が生成済みである。

---

## UC-1. 公開（ホスティング・共有URL発行）

| 項目 | 内容 |
| --- | --- |
| アクター | ビルダー利用者 |
| 目的 | 完成したプレビューを他者が閲覧できる URL として公開する |
| 種別 | ① ホスティング（S3/CloudFront 共有URL） ② 公開URL（`/run/[projectId]`） |

### 基本フロー（ホスティング）

1. ユーザーが「ホスティング」を押す。
2. システムは現在の HTML を S3/CloudFront に配置し（`POST /api/prototype` `mode="host"`）、共有 URL を発行する。
3. システムは `prototypes.demoUrl` に共有 URL を保存し、結果ストリップに URL を表示する。
4. ユーザーは共有 URL を開く／配布する。

### 代替・例外

- **A1. 公開URL（/run）**: 保存済み HTML は `/run/[projectId]` でも配信される（「公開URLを開く ↗」）。本実装（UC-2）版なら LQ SDK 注入で実データが動く。
- **A2. v0 エンジン**: v0 で生成した場合はホスティング込みで `demoUrl` が発行される。
- **E1. ホスティング未設定**: S3/CloudFront の環境変数が未設定だと「ホスティング未設定です」を返す（副作用なし）。
- **E2. 対象プレビューなし**: HTML が無いと「ホスティングするプレビューがありません」。

### ビジネスルール

- BR1. ホスティングは「プレビューに納得した後」の任意アクション（生成とは別操作）。
- BR2. 共有 URL は `prototypes.demoUrl` に保存し、再訪時に復元する。

---

## UC-2. ビルド（本実装 → GitHub / Vercel 引き継ぎ）

| 項目 | 内容 |
| --- | --- |
| アクター | ビルダー利用者 |
| 目的 | モックのプレビューを「実際に動くアプリ」に近づけ、開発リポジトリ／デプロイへ引き継ぐ |
| 種別 | ① 本実装（realize: 実データ保存版へ書き換え） ② 公開・引き継ぎ（GitHub リポジトリ＋Vercel デプロイ） |

### 基本フロー（本実装 realize）

1. ユーザーが「本実装（データ保存を有効化）」を押す。
2. システムは生成ジョブ（`kind="prototype"`, `mode="realize"`）を起動し、プレビュー HTML を LQ SDK でデータ保存・一覧する版に書き換える。
3. 完了後、システムは HTML を保存し、`/run/[projectId]` のライブプレビュー（実オリジン・SDK 注入）に切り替える。
4. ユーザーは実データの作成・一覧・削除（必要なら認証）が動くことを確認する。

### 基本フロー（公開・引き継ぎ handoff）

1. ユーザーが「公開・引き継ぎ」を押す。
2. システムは `POST /api/projects/[id]/publish` を実行し、GitHub リポジトリ生成＋Vercel デプロイを試みる（`publishProject`）。
3. 成功時、`prototypes.githubRepoUrl` / `deploymentUrl` を保存し、プロジェクトを `status="published"` にして結果（GitHub / Vercel リンク）を表示する。

### 代替・例外

- **E1. 引き継ぎ未連携（scaffold）**: `GITHUB_TOKEN` / `VERCEL_TOKEN` 未設定時は副作用なしで `status="not-configured"`（「未連携（トークン未設定）」）を返す。現状は scaffold 実装（TODO(handoff)）。
- **E2. 引き継ぎ失敗**: 実行時エラーは `status="failed"`（「引き継ぎ失敗」）。
- **E3. realize の途中切れ/タイムアウト**: 生成系のため UC（プロトタイプ生成）と同じく出力上限・300 秒制限の影響を受ける（途中切れ警告／reaper）。

### ビジネスルール

- BR1. 本実装版は `/run` で配信（`srcDoc` プレビューには SDK が無いため実データは動かない）。
- BR2. 引き継ぎ成功時のみプロジェクトを `published` に遷移。
- BR3. エンジニアに実装を委ねる場合は「エンジニアに依頼」（`/studio/[id]/engineer-request`、開発依頼ブリーフ生成）も併用できる。

---

## UC-3. デザイン依頼（デザイナー連携）

| 項目 | 内容 |
| --- | --- |
| アクター | ビルダー利用者 → （社外）デザイナー |
| 目的 | 完成したプレビューと分析結果を基に、デザイナーへ UI ブラッシュアップを依頼し、成果物を反映する |
| 対象画面 | `/studio/[id]/design-request` |

### 基本フロー

1. ユーザーが「デザイナーに依頼 →」で依頼画面へ遷移する。
2. ユーザーが「AIで依頼項目を生成」を押すと、システムが分析結果＋プロトタイプ有無を基にデザインブリーフを下書きする（ジョブ `kind="design-brief"`）。ユーザーはフォームで編集する。
3. ユーザーが「依頼を作成」する。システムはブリーフを保存し（`status="requested"`）、デザイナーに渡す Markdown をコピー／ダウンロードできるようにする。
4. （任意）ユーザーが「メールで送信」してデザイナーに依頼を送る（`POST /api/design-request/send`）。
5. デザイナーから成果物（Figma URL / PDF）を受領後、ユーザーが成果物を指定して「ブラッシュアップ（リファイン）」する（ジョブ `kind="design-refine"`）。システムは成果物を参照デザインとしてプロトタイプを再生成し、`status="received"` にして refinedHtml / refinedDemoUrl を表示する。

### 代替・例外

- **A1. ブリーフを手書き**: AI 下書きを使わず、フォームに直接記入してもよい。
- **A2. 生成中の離脱**: ブリーフ生成・リファインはジョブ化されており、画面遷移・リロードでも止まらず復帰できる。
- **E1. 成果物未指定**: Figma URL も PDF も無い状態でリファインすると「Figma URL もしくは PDF を指定してください」。
- **E2. リファインの途中切れ/タイムアウト**: 生成系のため出力上限・300 秒制限の影響を受ける。

### ビジネスルール

- BR1. 依頼状態は `draft → requested → received` の 3 段階（`design_requests.status`）。
- BR2. リファインは「参照ベースの再生成」（Figma→コード完全自動化や Figma MCP 連携は現状スコープ外）。
- BR3. リファイン結果は通常のプロトタイプ（`prototypes`）として保存され、以降の公開／ビルドへ続けられる。

---

## 関連実装（参照）

- 公開（ホスティング）: `src/app/api/prototype/route.ts`（`mode="host"`）、`src/lib/s3-publish.ts`、公開URL `src/app/run/[projectId]`
- ビルド（本実装/引き継ぎ）: `src/lib/jobs-runner.ts`（`runPrototypeJob` の `mode="realize"`）、`src/app/api/projects/[id]/publish/route.ts`、`src/lib/handoff.ts`
- デザイン依頼: `src/app/studio/[id]/design-request/page.tsx`、`src/app/api/design-request/{generate,refine,send}`、`src/lib/jobs-runner.ts`（`runDesignBriefJob` / `runDesignRefineJob`）
- ステータス: `projects.status`（`generating → published`）、`design_requests.status`（`draft/requested/received`）
