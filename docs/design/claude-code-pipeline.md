# MVP Builder パイプラインの Claude Code 移植 — 設計

## 1. ゴール

MVP Builder（Web アプリ）が持つ「事業情報 → 13 工程の分析・設計 → クリック可能プロトタイプ」を、
**Claude Code だけで同じ品質・同じ出力形で回せる**ようにする。加えて、既存プロジェクトの
成果物を MCP 経由で引き、Claude Code 版の出力と突き合わせる**検証モード**を持つ。

- 実行主体: Claude Code（サブエージェント／スキル／スラッシュコマンド）
- 成果物の置き場所: 本リポジトリの `.claude/` 配下（Web アプリ本体と同居させ、プロンプト源を共有する）
- 対象範囲: 13 工程 + プロトタイプ生成まで（デザイナー/エンジニアブリーフ・提案デッキは今回スコープ外）

### 非ゴール

- Web アプリ（Next.js / Neon / Clerk）の置き換えそのもの
- v0 Platform API 経路の再現（本体でも廃止済み。DS エンジン経路のみ対象）
- S3 公開・Vercel デプロイ・GitHub 引き継ぎ

---

## 2. いちばん重要な設計判断: プロンプトとスキーマを二重管理しない

素朴に移植すると、`src/lib/ai/steps.ts` の長大なシステムプロンプトを Markdown に手で写すことになる。
これは確実に腐る（本体を直した瞬間に Claude Code 版が古くなる）。

**採用: 生成方式。** 本体の TypeScript を単一ソースとし、Claude Code 用の資産を機械生成する。

```
src/lib/ai/steps.ts     ─┐
src/lib/ai/schemas.ts    ├→ scripts/gen-claude-skill.ts ─→ .claude/skills/mvp-pipeline/references/*
src/lib/ai/pipeline.ts  ─┘                               ─→ .claude/agents/mvp-*.md
```

- 前例がリポジトリ内にある（`scripts/gen-daisyui-reference.ts` → `src/lib/prototype-ds/daisyui-reference.ts`）。同じ作法を逆方向に使うだけ。
- スキーマは zod v4 の `z.toJSONSchema()` で JSON Schema に落とす（`zod@4.4.3` 導入済み）。
- 生成物は `// 自動生成: 手で編集しない` ヘッダ付きでコミットする（Claude Code は生成なしで即使える）。
- CI/lint に「生成物が最新か」チェックを足せば乖離を検知できる。

これにより、**Claude Code 版の分析品質＝本体の分析品質**が構造的に保証される。

---

## 3. 写像表

| MVP Builder（Web） | Claude Code 版 |
| --- | --- |
| `runPipelineParallel` の WAVES 並列実行 | ウェーブ単位でサブエージェントを 1 メッセージ同時起動 |
| `STEP_ROLES` のロール注入 | `.claude/agents/mvp-<step>.md` の system prompt にロールを固定 |
| `generateStructured`（zod で構造化強制） | サブエージェントが `artifacts/<step>.json` を書く → `validate.mjs` が zod で検証 → 不一致なら 1 回だけ修正指示 |
| DB 永続化（`projects` / `artifacts`） | `.mvp/<slug>/artifacts/*.json`（プレーンな JSON ファイル） |
| コンテキスト積み上げ（`context += JSON.stringify(result)`） | 直前ウェーブまでの `artifacts/*.json` をサブエージェントに Read させる |
| provider / modelId 切替、`FAST_STEPS` | エージェント frontmatter の `model:`（actors/usecases/journey は haiku、他は sonnet、必要なら opus） |
| `planOrchestration`（要望 → 再実行工程の計画） | `/mvp-update "<要望>"` コマンド（同じ判断基準のプロンプトを流用） |
| DS エンジン（骨格コード固定＋画面ごと LLM 生成） | 骨格は `buildDsHtml` をそのまま再利用。画面生成だけサブエージェント |
| 進捗ジョブ（`jobs` テーブル / SSE） | Claude Code のサブエージェント進捗表示 |
| MCP `get_project` | 検証モードの入力として同じ MCP を使う |

### 再利用できる本体コード（重要）

スクリプトから **そのまま import できる**（Node 24 の型ストリップで `.ts` を直接読める）:

- `src/lib/prototype-ds/shell.ts` — `buildDsHtml()`。**import 文ゼロの純関数**。骨格・ルーター・ナビ描画を丸ごと再利用できる。
- `src/lib/ai/schemas.ts` — zod のみ依存。検証にそのまま使える。
- `src/lib/prototype-ds/daisyui-reference.ts` — 文字列定数のみ。画面生成エージェントの参照資料にそのまま渡す。

これがあるので、Claude Code 版のプロトタイプは「LLM が HTML 全体を吐く」形ではなく、
本体と同じ **「骨格＝コード / 画面＝小さな自己完結コンポーネント」** 方式にできる。構造崩れ・途中切れが起きない。

---

## 4. ディレクトリ構成

```
.claude/
├── skills/
│   └── mvp-pipeline/
│       ├── SKILL.md                    # 全体手順（オーケストレーション）
│       ├── references/
│       │   ├── steps.md                # ⚙自動生成: 13工程のsystemプロンプト全文
│       │   ├── schemas/<step>.json     # ⚙自動生成: 各工程の JSON Schema
│       │   ├── waves.md                # ⚙自動生成: 依存ウェーブ定義
│       │   └── prototype.md            # DSエンジンの使い方・画面生成の規約
│       └── scripts/
│           ├── validate.mjs            # artifacts/*.json を zod で検証
│           ├── screen-units.mjs        # nav → 生成対象画面（リーフ + ◯◯詳細）を導出
│           ├── assemble.mjs            # buildDsHtml で単一HTMLへ組み立て
│           ├── fetch-reference.mjs     # 検証モード: MCP/API から既存成果物を取得
│           └── compare.mjs             # 検証モード: 構造差分レポート
├── agents/
│   ├── mvp-actors.md  … mvp-brand.md   # ⚙自動生成: 13体
│   └── mvp-screen.md                   # プロトタイプ1画面生成
└── commands/
    ├── mvp-run.md      # フルパイプライン（13工程 → プロトタイプ）
    ├── mvp-step.md     # 単一工程の再実行
    ├── mvp-update.md   # 要望 → 再実行工程を計画して回す
    ├── mvp-proto.md    # プロトタイプのみ生成/部分再生成
    └── mvp-diff.md     # 検証モード

scripts/
└── gen-claude-skill.ts                 # 上記 ⚙ を生成

.mvp/                                   # 実行時データ（.gitignore）
└── <project-slug>/
    ├── input/           # 入力資料（PDF/URL要約/テキスト）
    ├── project.json     # name / summary / analysisResult(JTBD)
    ├── artifacts/       # actors.json … brand.json
    ├── prototype/
    │   ├── screens/     # Screen0.jsx … （部分再生成のマージ元）
    │   ├── theme.json
    │   └── index.html
    └── reference/       # 検証モード: MCP から取得した本体の出力
```

---

## 5. 実行フロー

### 5.1 入力（前段）

本体の「資料読込 → JTBD 対話 → 概要確定」に相当。

- PDF は Claude Code の Read がネイティブに読む（本体の `unpdf` 相当は不要）
- URL は WebFetch
- **JTBD インタビューはここが Claude Code の強み**。本体は `/api/jtbd` のチャットで対話しているが、Claude Code なら本来の対話形式でそのまま深掘りできる。合意結果を `project.json` の `analysisResult` に保存し、以降 `jtbdSection()` と同じ「入力資料より優先」の扱いをする。

### 5.2 13 工程（ウェーブ並列）

`pipeline.ts` の WAVES をそのまま踏襲する。

```
wave1: actors                          (haiku)
wave2: usecases                        (haiku)
wave3: journey                         (haiku)
wave4: market                          (sonnet)
wave5: ooui / scope / brand            ← 3体同時
wave6: navigation / datamodel / kpi    ← 3体同時
wave7: wireframe / backend / growth    ← 3体同時
```

各サブエージェントの手順（`.claude/agents/mvp-<step>.md` に固定）:

1. ロール宣言（`STEP_ROLES` 由来）＋ 工程プロンプト（`steps.ts` 由来）を system として持つ
2. `.mvp/<slug>/project.json` と、前ウェーブまでの `artifacts/*.json` を Read
3. `references/schemas/<step>.json` に厳密に従う JSON を `artifacts/<step>.json` に Write
4. 返り値は 1 行サマリのみ（本文をコンテキストに戻さない＝親のコンテキストを汚さない）

ウェーブ完了ごとに親が `validate.mjs` を実行。スキーマ不一致なら該当エージェントに
**同じセッションで**（SendMessage）修正させる。2 回失敗したら止めてユーザーに報告する。

> **注意点（本体との差）**: 本体は `generateStructured` でスキーマ準拠が API レベルで保証される。
> Claude Code のサブエージェントは保証されないので、検証＋リトライで担保する。ここが移植で
> いちばん壊れやすい箇所なので、`validate.mjs` はエラーメッセージを「どのパスがどう違うか」まで
> 具体的に出す（zod の `error.issues` をそのまま整形）。

### 5.3 プロトタイプ生成

`jobs-runner.ts:270-505`（`runDsPrototypeJob`）の移植。

1. `screen-units.mjs` が `artifacts/navigation.json` から生成対象画面を導出
   - 親（他項目の `parent` になっているラベル）はグループ見出し扱いで画面を作らない
   - `screenType` に `list` を含む画面には `「◯◯詳細」` を自動追加（`listLabel` 付き）
2. `mvp-screen` サブエージェントを画面数ぶん並列起動（実測 8〜15 画面）
   - system: `generate-screen.ts` の `SYSTEM_BASE` 全文（React UMD / `useState` のみ / daisyUI 5 / `<Page>` ルート / `navigate()` 規約）
   - 参照資料: `DAISYUI_REFERENCE`
   - 一覧画面には `navigate("◯◯詳細")` の遷移指示、詳細画面には戻り導線の指示を注入（本体と同文）
   - 出力: `prototype/screens/Screen<i>.jsx`
3. テーマ: `generate-theme.ts` 相当を 1 エージェントで生成 → `prototype/theme.json`
4. `assemble.mjs` が `buildDsHtml()` を呼んで `prototype/index.html` を出力
5. サニタイズ（`sanitizeScreen` の関数名リネーム・括弧バランス検査・失敗時プレースホルダ）は
   **`assemble.mjs` 側に移植**する。エージェントに任せない

**部分再生成**は本体と同じ非破壊マージ: `prototype/screens/` に残っているものを再利用し、
指定画面だけ作り直して `componentName` を採番し直す。

> **本体側にも小改修を提案**: 画面ユニット導出（`jobs-runner.ts:286-310`）と `sanitizeScreen`
> （`generate-screen.ts:123-174`）は純ロジックなのに実装内に埋まっている。
> `src/lib/prototype-ds/screen-units.ts` / `sanitize.ts` として切り出せば、Web と Claude Code の
> **両方から同じコードを使える**。二重実装をここでも避けられる。

### 5.4 要望反映（orchestrate 相当）

`/mvp-update "リード一覧に絞り込みを足して"` で:

1. `planOrchestration` と同じ判断基準のプロンプトで、再実行すべき工程と `regeneratePrototype` を決める
2. 決まった工程だけを依存順に再実行（下流の工程も必要なら連鎖）
3. `regeneratePrototype` なら影響画面だけ部分再生成

---

## 6. 検証モード（`/mvp-diff`）

```
/mvp-diff https://<host>/studio/<uuid>
```

1. `mcp__mvp-builder__get_project` で本体の成果物一式を取得 → `.mvp/<slug>/reference/`
2. 同じ入力（`sourceText` / `analysisResult` / `summary`）で Claude Code 版パイプラインを実行
3. `compare.mjs` が構造差分を出す:
   - **数の差**: アクター数 / ユースケース数 / OOUI オブジェクト数 / ナビ項目数 / MVP 機能数
   - **集合の差**: OOUI オブジェクト名、ナビ `label`、`includedInMvp` な機能名の 3 集合について「両方にある / 本体のみ / CC のみ」
   - **判断の差**: `backend`（needsAuth/Db/Storage）の真偽、`scope` の `priority` 不一致、`market.competitors` の顔ぶれ
4. 差分は自動で優劣を判定せず、**「どちらが妥当か」を Claude Code に短く論評させて**レポート化する

用途は 2 つ: (a) Claude Code 版が本体と同等かの回帰チェック、(b) 本体のプロンプト改善のネタ出し
（`STEP_ROLES` やプロンプト文言を変えた効果を、既存プロジェクトで A/B できる）。

---

## 7. 段階計画

| Phase | 内容 | 完了条件 | 状況 |
| --- | --- | --- | --- |
| 0 | `scripts/gen-claude-skill.ts` + 生成物のコミット | `pnpm gen:skill` で 13 エージェント・スキーマ・references が出る | ✅ 完了 |
| 1 | `mvp-pipeline` スキル + 13 工程 + `validate.ts` + `/mvp-run` `/mvp-step` | 実プロジェクト 1 本で 13 個の artifacts が全てスキーマ検証を通る | ✅ 完了（下記） |
| 2 | プロトタイプ（`screen-units` / `mvp-screen` / `assemble`） | `index.html` がブラウザで開き、一覧→詳細→戻るが動く | 未着手 |
| 3 | `/mvp-diff` 検証モード | 既存プロジェクト 1 本で差分レポートが出る | 🟡 スクリプトのみ（`fetch-reference.ts` / `compare.ts`）。コマンド未作成 |
| 4 | `/mvp-update` 要望反映・部分再生成 | 要望 1 件で該当工程＋該当画面だけが更新される | 未着手 |
| 5（任意） | `.claude/workflows/mvp-pipeline.js` | ウェーブ並列を決定的に回す版（`agent(..., {schema})` でスキーマ強制が効くので検証リトライが不要になる） | 未着手 |

### 実測（2026-08-02・社労士顧客管理システムで通し実行）

入力はジョブ分析(JTBD) 1,178 字のみ（本体と同一条件）。13/13 がスキーマ検証を一発通過、リトライ 0。

**発見1: 上流工程に高速モデルを使うと下流まで薄くなる。**
本体と同じ `FAST_STEPS`（actors/usecases/journey→haiku）で回したところ、
usecases が 4 件（本体 8 件）、actors が 3 件（system アクターを落とす）となり、
ooui 5 / navigation 5 / wireframe 9 と下流すべてが痩せた。
同じ工程を sonnet で再実行すると usecases 12 件・actors 5 件になり、
再度下流を回すと ooui 8 / navigation 6 / wireframe 11 と本体（9 / 7 / 12）に並んだ。

本体は `generateObject` でスキーマを強制した 1 回生成なのに対し、CC ではサブエージェントが
「どこまで書くか」を自分で決めるため、この差が出る。**CC 版は全工程を sonnet で回す**
（`scripts/gen-claude-skill.ts` の `AGENT_MODEL`）。本体側の `FAST_STEPS` は変更しない。

**発見2: CC 版のほうが入力に忠実な箇所がある。**

- `needsStorage`: 本体 false / CC true。JTBD に「ファイル送付」の記述があり CC が妥当。
- 市場規模の前提: CC は登録者数→事務所数→単価→%の算出過程を明示。本体は前提が粗い。
- OOUI: 本体は入力に無い「案件」を立てる。CC は JTBD の「シャドウモード・キルスイッチ」から
  「AI精度検証」「AI運用設定」を立てる。CC のほうが入力に紐づいている。

**発見3（本体側の不具合）→ 修正済み**: `use_cases` テーブルは `actorId` を持つが
`saveStepResult` が一度も設定せず、`actorName` を `description` の先頭に `"名前: 説明"` として
埋め込んでいた。結果 `actorId` は常に null で、MCP `get_project` の `useCases` からアクターを
構造的に辿れなかった（studio 側は description の接頭辞をパースして凌いでいた）。

修正内容:

- 書き込み（`saveStepResult`）: `actorName` を actors の id に解決して `actorId` に保存。
  `description` には名前を埋め込まない。
- 読み取り（`getProjectWithArtifacts`）: `actorId` から `actorName` を解決して返す。
  旧形式の行は description の接頭辞から補い、description からは取り除く（既存データ互換）。
- アクター単独再生成で FK が落ちないよう、同名アクターへ紐付けを貼り直す。
- studio 側の接頭辞パースは不要になったため削除。

Phase 5 の Workflow 版は、実は `runPipelineParallel` に**構造的にいちばん近い**（`parallel()` がウェーブ、
`schema` オプションが `generateStructured` に対応する）。ただし起動にユーザーの明示的な opt-in が要るので、
日常的に使う入口はスキル＋サブエージェント（Phase 1〜4）に置き、Workflow は「フル実行の高速版」として併設する。

---

## 8. リスクと対処

| リスク | 対処 |
| --- | --- |
| 構造化出力が保証されない | `validate.mjs`（zod）+ 1 回リトライ。Phase 5 の Workflow 版なら schema 強制で解消 |
| プロンプトの乖離 | 生成方式（§2）。CI で生成物の鮮度チェック |
| 親コンテキストの肥大 | サブエージェントは artifacts をファイル経由で受け渡し、返り値は 1 行サマリのみ |
| 画面生成の失敗 | 本体と同じプレースホルダ＋部分再生成。サニタイズはコード側 |
| モデル差による品質ぶれ | 本体の `FAST_STEPS` と同じ割り当てから始め、`/mvp-diff` の結果で調整 |
| `.mvp/` の混入 | `.gitignore` に追加。プロジェクト成果物は Web 側 DB が正 |

## 9. 判断が要る残件

- **`.mvp/` の置き場所** — リポジトリ内（`.gitignore`）か、`~/.mvp/` などリポジトリ外か。複数プロジェクトを跨いで使うなら後者。
- **ブリーフ / 提案デッキ** — 今回スコープ外だが、`generateDesignBrief` / `generateEngineerBrief` / `deck.ts` は同じ写像で足せる（工程を 3 つ増やすだけ）。
- **「本実装」変換（`realizePrototypeHtml`）** — LQ SDK 前提なので Claude Code 単体では意味が薄い。Claude Code なら「プロトタイプ → 実際の Next.js アプリを書く」に置き換える方が自然。別設計とする。
