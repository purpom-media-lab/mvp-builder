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
- Claude Code からの**新規プロジェクト作成**（書き戻しは既存プロジェクトの更新のみ）
- プロトタイプ HTML の書き戻し（成果物 13 工程のみ）

---

## 2. いちばん重要な設計判断: プロンプトとスキーマを二重管理しない

素朴に移植すると、`src/lib/ai/steps.ts` の長大なシステムプロンプトを Markdown に手で写すことになる。
これは確実に腐る（本体を直した瞬間に Claude Code 版が古くなる）。

**採用: 生成方式。** 本体の TypeScript を単一ソースとし、Claude Code 用の資産を機械生成する。

```
src/lib/ai/step-specs.ts            ─┐                   ─→ .claude/agents/mvp-*.md
src/lib/prototype-ds/prompt.ts       ├→ gen-claude-skill ─→ .claude/skills/mvp-pipeline/references/*
src/lib/prototype-ds/theme-spec.ts   │
src/lib/prototype-ds/daisyui-reference.ts ─┘
```

13 工程の仕様は `step-specs.ts`（ロール／system プロンプト／zod スキーマ／ウェーブ）に集約し、
`steps.ts` / `pipeline.ts` / `run-step.ts` もそこを参照する。プロトタイプ側も同様に
`prompt.ts` / `theme-spec.ts` を単一ソースにして、Web と Claude Code が同じ文字列を使う。

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
| `generateStructured`（zod で構造化強制） | サブエージェントが `artifacts/<step>.json` を書く → `validate.ts` が zod で検証 → 不一致なら 1 回だけ修正指示 |
| DB 永続化（`projects` / `artifacts`） | `.mvp/<slug>/artifacts/*.json`（プレーンな JSON ファイル） |
| コンテキスト積み上げ（`context += JSON.stringify(result)`） | 直前ウェーブまでの `artifacts/*.json` をサブエージェントに Read させる |
| provider / modelId 切替、`FAST_STEPS` | エージェント frontmatter の `model:`（全工程 sonnet。理由は §7 の発見1） |
| `planOrchestration`（要望 → 再実行工程の計画） | `mvp-orchestrate` サブエージェント（`ORCHESTRATE_SYSTEM` を共有）→ `/mvp-update` |
| DS エンジン（骨格コード固定＋画面ごと LLM 生成） | 骨格は `buildDsHtml` をそのまま再利用。画面生成だけサブエージェント |
| 進捗ジョブ（`jobs` テーブル / SSE） | Claude Code のサブエージェント進捗表示 |
| MCP `get_project` | 検証モードの入力として同じ MCP を使う |
| 手動編集の保存（`/api/save-step`） | MCP `save_step`（同じ `saveStepResult` を呼ぶ）。write スコープのトークンが要る |

### 再利用できる本体コード（重要）

スクリプトから **そのまま import できる**（Node 24 の型ストリップで `.ts` を直接読める）:

- `src/lib/prototype-ds/shell.ts` — `buildDsHtml()`。**import 文ゼロの純関数**。骨格・ルーター・ナビ描画を丸ごと再利用できる。
- `src/lib/ai/schemas.ts` — zod のみ依存。検証にそのまま使える。
- `src/lib/prototype-ds/daisyui-reference.ts` — 文字列定数のみ。画面生成エージェントの参照資料にそのまま渡す。

これがあるので、Claude Code 版のプロトタイプは「LLM が HTML 全体を吐く」形ではなく、
本体と同じ **「骨格＝コード / 画面＝小さな自己完結コンポーネント」** 方式にできる。構造崩れ・途中切れが起きない。

---

## 4. ディレクトリ構成

スクリプトはすべて TypeScript（`.ts`）で、`pnpm exec tsx` で実行する。本体のコードを
相対 import して再利用するため（`../../../../src/lib/...`）、素の `.mjs` にはしない。

```
.claude/
├── skills/
│   └── mvp-pipeline/
│       ├── SKILL.md                    # 全体手順（オーケストレーション）
│       ├── references/
│       │   ├── schemas/<step>.json     # ⚙自動生成: 各工程 + theme の JSON Schema
│       │   ├── waves.md                # ⚙自動生成: 依存ウェーブ定義
│       │   ├── daisyui.md              # ⚙自動生成: daisyUI 5 リファレンス（画面生成が Read）
│       │   └── prototype.md            # DSエンジンの規約・失敗時の直し方
│       └── scripts/
│           ├── validate.ts             # artifacts/*.json を zod で検証
│           ├── plan-screens.ts         # nav → 生成対象画面を導出し、画面別プロンプトを出力
│           ├── assemble.ts             # サニタイズ + buildDsHtml で単一HTMLへ組み立て
│           ├── fetch-reference.ts      # 検証モード: MCP から既存成果物を取得
│           ├── compare.ts              # 検証モード: 構造差分レポート
│           ├── push.ts                 # 成果物を本体 DB へ書き戻す
│           ├── plan-update.ts          # 要望反映: 計画をウェーブ順に展開
│           └── _lib.ts                 # 共通（usage / zod issue 整形 / 工程間の整合性）
├── agents/
│   ├── mvp-actors.md  … mvp-brand.md   # ⚙自動生成: 13体
│   ├── mvp-screen.md                   # ⚙自動生成: プロトタイプ1画面生成
│   ├── mvp-theme.md                    # ⚙自動生成: daisyUI テーマ設計
│   └── mvp-orchestrate.md              # ⚙自動生成: 要望→再実行工程の判断
└── commands/
    ├── mvp-run.md      # フルパイプライン（13工程 → プロトタイプ）
    ├── mvp-step.md     # 単一工程の再実行
    ├── mvp-proto.md    # プロトタイプのみ生成/部分再生成
    ├── mvp-diff.md     # 検証モード（本体と突き合わせる）
    ├── mvp-push.md     # 本体（Web アプリ）へ書き戻す
    └── mvp-update.md   # 要望 → 再実行工程を計画して回す

workflows/
└── mvp-pipeline.js                     # ⚙自動生成: ウェーブ並列を決定的に回す版

scripts/
└── gen-claude-skill.ts                 # 上記 ⚙ を生成（pnpm gen:skill）

.mvp/                                   # 実行時データ（.gitignore）
└── <project-slug>/
    ├── input/           # 入力資料（PDF/URL要約/テキスト）
    ├── project.json     # name / summary / analysisResult(JTBD)
    ├── artifacts/       # actors.json … brand.json
    ├── prototype/
    │   ├── plan.json    # 生成対象の画面一覧・ナビ・ブランドパレット
    │   ├── prompts/     # <i>.md（画面別プロンプト）/ theme.md
    │   ├── screens/     # <i>.jsx（部分再生成のマージ元）
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

ウェーブ完了ごとに親が `validate.ts` を実行。スキーマ不一致なら該当エージェントに
**同じセッションで**（SendMessage）修正させる。2 回失敗したら止めてユーザーに報告する。

> **注意点（本体との差）**: 本体は `generateStructured` でスキーマ準拠が API レベルで保証される。
> Claude Code のサブエージェントは保証されないので、検証＋リトライで担保する。ここが移植で
> いちばん壊れやすい箇所なので、`validate.ts` はエラーメッセージを「どのパスがどう違うか」まで
> 具体的に出す（zod の `error.issues` をそのまま整形）。

### 5.3 プロトタイプ生成

`runDsPrototypeJob`（`jobs-runner.ts`）の移植。**本体のロジックをコピーせず、同じ関数を呼ぶ**
（下記の切り出し済み）。

1. `plan-screens.ts` が `artifacts/*.json` を読み、`deriveScreenUnits()` で生成対象画面を導出
   - 親（他項目の `parent` になっているラベル）はグループ見出し扱いで画面を作らない
   - `screenType` に `list` を含む画面には `「◯◯詳細」` を自動追加（`listLabel` 付き）
   - 画面ごとのプロンプト（`buildScreenContext()` の結果）を `prototype/prompts/<i>.md` に書く。
     こうすると各サブエージェントは自分の 1 ファイルを Read するだけで済み、親のコンテキストに
     プロンプト全文が乗らない
2. `mvp-screen` サブエージェントを画面数ぶん並列起動（実測 9 画面）
   - system: `prompt.ts` の `SCREEN_SYSTEM` 全文（React UMD / `useState` のみ / daisyUI 5 /
     `<Page>` ルート / `navigate()` 規約）＝ 本体が渡しているものと同一
   - 参照資料: `references/daisyui.md`（`DAISYUI_REFERENCE` から生成）を Read させる
   - 出力: `prototype/screens/<i>.jsx`（関数名は `Screen` のまま。採番は組み立て側）
3. テーマ: `mvp-theme` 1 体が `prototype/theme.json` を書く（`THEME_SYSTEM` + `themeSchema`）。
   ブランドに基調色が無ければ起動せず、`paletteToTheme()` の導出に任せる
4. `assemble.ts` が `sanitizeScreen()` → `buildDsHtml()` の順に呼んで `prototype/index.html` を出力
5. サニタイズ（関数名リネーム・括弧バランス検査・失敗時プレースホルダ）とテーマのスキーマ検証は
   **`assemble.ts` 側**で行う。エージェントに任せない

**部分再生成**は本体と同じ非破壊マージ: `prototype/screens/` に残っているものを再利用し、
指定画面だけプロンプトを作り直す。未生成の画面は指定に関わらず必ず作る。
判定は `shouldRegenerateScreen()`（`screen-units.ts`）を Web と共有し、
存在確認だけを外から渡す（Web は保存済みレコード、CC はファイルの有無）。
一覧を選ぶと対の「◯◯詳細」も作り直す — 内容が対になっているため。

> **本体側の小改修（実施済み）**: 画面ユニット導出・サニタイズ・プロンプト組み立ては純ロジック
> なのに `jobs-runner.ts` / `generate-screen.ts` の実装内に埋まっていた。
> `src/lib/prototype-ds/{screen-units,sanitize,prompt,theme-spec}.ts` に切り出し、Web と
> Claude Code の**両方が同じコードを呼ぶ**ようにした。あわせて `shell.ts` の `paletteToTheme`
> を export（テーマ生成失敗時のフォールバック用）。
> 動作不変であることは、旧インラインロジックを再現して 9 画面ぶんのプロンプト文字列まで
> 突き合わせて確認している。

### 5.4 要望反映（orchestrate 相当）

`/mvp-update <projectDir> "リード一覧に絞り込みを足して"` で:

1. `mvp-orchestrate` が、再実行すべき工程と `regeneratePrototype` を決めて
   `update-plan.json` に書く。判断基準（`ORCHESTRATE_SYSTEM`）と出力スキーマ
   （`orchestratePlanSchema`）は本体の `planOrchestration()` と**同じものを共有**する
2. `plan-update.ts` が計画をウェーブ順に展開する。`ooui` を選んだときに `navigation` を
   後続へ足す規則（`normalizeSteps`）も本体と共有
3. 展開された順に工程を再実行し、ウェーブごとに検証する
4. `regeneratePrototype` なら `plan-screens.ts` でプロトタイプを作り直す
   （画面名を指定すれば部分再生成）

> `normalizeSteps(requested, order)` が並び順を引数に取るのは、**本体と CC 版で実行順が
> 違う**ため。本体は 1 工程ずつ逐次実行するので自前の直列順を持ち、CC 版はウェーブ並列で
> 回すので `STEP_ORDER`（`WAVES.flat()`）に従う。どちらも依存は満たすが順番は同じでない。
> 共有したのは「`ooui` なら `navigation` を足す」という規則だけ。

---

## 6. 検証モード（`/mvp-diff`）

```
/mvp-diff https://<host>/studio/<uuid>
```

`fetch-reference.ts` は MCP の通信を**公式 SDK**（`@modelcontextprotocol/sdk`、本 repo の
直接依存）に任せる。プロトコルのバージョンネゴシエーション・SSE の解釈・セッション終了を
自前で書くと、サーバ側（`src/app/api/mcp/route.ts` の `mcp-handler`）が上がったときに
ここだけ取り残されるため。

1. `get_project` で本体の成果物一式を取得 → `.mvp/<slug>/reference/`
2. 同じ入力（`sourceText` / `analysisResult` / `summary`）で Claude Code 版パイプラインを実行
3. `compare.ts` が構造差分を出す:
   - **数の差**: アクター数 / ユースケース数 / OOUI オブジェクト数 / ナビ項目数 / MVP 機能数
   - **集合の差**: OOUI オブジェクト名、ナビ `label`、`includedInMvp` な機能名の 3 集合について「両方にある / 本体のみ / CC のみ」
   - **判断の差**: `backend`（needsAuth/Db/Storage）の真偽、`scope` の `priority` 不一致、`market.competitors` の顔ぶれ
4. 差分は自動で優劣を判定せず、**「どちらが妥当か」を Claude Code に短く論評させて**レポート化する

用途は 2 つ: (a) Claude Code 版が本体と同等かの回帰チェック、(b) 本体のプロンプト改善のネタ出し
（`STEP_ROLES` やプロンプト文言を変えた効果を、既存プロジェクトで A/B できる）。

> **`reference/` を分析中に読ませないこと。** 本体の答えを見たまま再分析すると「写す」だけになり
> 品質比較にならない。`fetch-reference.ts` は入力（`project.json`）と正解（`reference/`）を
> 物理的に分けて保存する。既存の `project.json` があると上書きを避けて止まる（`--force` で強行）。

### 実測（2026-08-03・本番の MCP に接続して確認）

- `fetch-reference.ts`: UUID 指定・studio URL 指定の両方で取得成功
  （社労士顧客管理システム: actors=5 / useCases=8 / ooui=9 / navigation=7 / wireframes=12 / scope=10）。
  不正な projectId ではサーバのエラーメッセージがそのまま出る。上書きガードも動作
- `compare.ts`: 件数表・名前集合 5 種・バックエンド判定・北極星指標・MVP ステートメント・
  TAM/SAM/SOM が出ることを確認

`compare.ts` の名前照合は完全一致なので「MVPに含む機能」は一致 0 と出るが、
中身は 10 件中 9 件が同じ機能（表記の粒度が違うだけ）。この限界はスクリプト冒頭に明記してあり、
SKILL.md にも「一致 0 でも中身を読む」と手順として書いてある。

---

## 7. 段階計画

| Phase | 内容 | 完了条件 | 状況 |
| --- | --- | --- | --- |
| 0 | `scripts/gen-claude-skill.ts` + 生成物のコミット | `pnpm gen:skill` で 13 エージェント・スキーマ・references が出る | ✅ 完了 |
| 1 | `mvp-pipeline` スキル + 13 工程 + `validate.ts` + `/mvp-run` `/mvp-step` | 実プロジェクト 1 本で 13 個の artifacts が全てスキーマ検証を通る | ✅ 完了（下記） |
| 2 | プロトタイプ（`plan-screens` / `mvp-screen` / `mvp-theme` / `assemble` / `/mvp-proto`） | `index.html` がブラウザで開き、一覧→詳細→戻るが動く | ✅ 完了（下記） |
| 3 | `/mvp-diff` 検証モード | 既存プロジェクト 1 本で差分レポートが出る | ✅ 完了（下記） |
| 4 | `/mvp-update` 要望反映・部分再生成 | 要望 1 件で該当工程＋該当画面だけが更新される | ✅ 完了（下記） |
| 5（任意） | `.claude/workflows/mvp-pipeline.js` | ウェーブ並列を決定的に回す版 | ✅ 完了（下記） |

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

### 実測（2026-08-03・Phase 2 を同じプロジェクトで通し実行）

ナビ 6 項目（うち親 1）→ **生成対象 9 画面**（リーフ 5 + 詳細 4）。
`mvp-screen` 9 体 + `mvp-theme` 1 体を 1 メッセージで並列起動し、**9/9 成功・サニタイズ落ち 0**。
`index.html` 169,688 文字。ブラウザで開いて確認した結果:

- 2 階層ナビが描画される（`AI運用設定` は画面を持たないグループ見出し、配下に `精度検証`）
- 4 つの一覧すべてで **一覧 → ◯◯詳細 → 「← ◯◯に戻る」** が往復する
- コンソールエラーなし（favicon の 404 のみ）
- テーマは `theme.json` が適用され、ブランドの基調色 `#A97C50` が反映されている

**本体の回帰**: 使い捨てプロジェクトを作って `runJob(kind="prototype", engine="ds")` を実行し、
9 画面・失敗 0・`Screen0..Screen8` の採番・テーマ生成を確認（27.7s）。
続けて `selectedScreens: ["顧客"]` で部分再生成し、**変わったのは `顧客` の 1 画面だけ**・
テーマは再利用されることを確認した。確認後にプロジェクトは削除済み。

### Phase 5: Workflow 版（`.claude/workflows/mvp-pipeline.js`）

`runPipelineParallel` に**構造的にいちばん近い**のがこれ（`parallel()` がウェーブに対応する）。
スキル版との違いは、**並列の粒度・検証・リトライがスクリプトで固定される**こと。
オーケストレータの判断に委ねないので、「並列にし忘れた」「検証を飛ばした」が起きない。

```
args = { projectDir: ".mvp/lead-crm" }
```

1. ウェーブごとに `parallel()` で工程を同時起動
2. そのウェーブを `validate.ts` にかけ、結果を `schema` で構造化して受け取る
3. 失敗があれば**エラー明細を渡して 1 回だけ作り直す**。2 回目も通らなければ
   その場で止めて返す（手で JSON を書き換えない）
4. 13 工程が揃ったら `plan-screens.ts` → `mvp-screen` を画面数ぶん並列 → `assemble.ts`

**スクリプト自体も生成物。** Workflow スクリプトはプレーンな JS で import できないため、
ウェーブ定義と工程名を埋め込む必要がある。手で写すと `step-specs.ts` からずれるので
`gen-claude-skill.ts` が生成する（他の生成物と同じ扱い）。

> **設計書の当初の想定は外した。** 「`agent(..., {schema})` でスキーマ強制が効くので検証
> リトライが不要になる」と書いていたが、成果物は**ファイル**（`artifacts/*.json`）であって
> エージェントの戻り値ではない。Workflow スクリプトはファイルシステムに触れないので、
> 書くのはサブエージェント側のまま。したがって `validate.ts` による検証は Workflow 版でも要る。
> `schema` は検証結果の受け取り（`{ok, failures[]}`）に使っている。

**起動にはユーザーの明示的な opt-in が要る**（Workflow ツールの制約）。そのため日常の入口は
スキル＋サブエージェント（Phase 1〜4）のままで、Workflow は「取りこぼしなく一息に通したいとき」の
併設という位置づけにする。

---

## 7.5 本体への書き戻し（`/mvp-push`）

Claude Code 側で作った成果物を本体のプロジェクトへ保存する。**読み取り専用だった MCP を
読み書きにする変更**なので、次の設計にした。

**経路は本体の手動編集と同じ。** MCP の `save_step` ツールが `saveStepResult()` を呼ぶ
（`/api/save-step` と同じ関数）。書き込みロジックを別に書かないので、洗い替え・
`actorId` の解決・`ooui` 保存後のナビ自動再生成がそのまま効く。

**トークンにスコープを足した。** `signMcpToken(ownerId, ttl, now, "read" | "write")`。
署名ペイロードに `s` が無い古いトークンは **`read` として扱う**。書き込みを足したときに
発行済みトークンが黙って書き込み可になると、漏れたときの影響が「閲覧」から
「成果物の上書き・破壊」に変わってしまうため。ダッシュボードのカードは既定 read で、
チェックを入れたときだけ write を発行する。

**検証は 2 段。** `push.ts` が送信前に本体と同じ zod スキーマで検証し、1 件でも
不一致なら何も送らずに中止する。サーバ側の `save_step` でも同じ検証をする
（CC 以外のクライアントから壊れた成果物が入らないように）。

### 実測（2026-08-03・ローカルの dev サーバで確認）

| 確認項目 | 結果 |
| --- | --- |
| 読み取り専用トークンで `save_step` | ✅ 拒否され、再発行の案内が出る |
| 書き込みトークンで 13 工程を送信 | ✅ 依存順に 13/13 保存 |
| DB に入った件数 | ✅ actors 5 / useCases 12 / ooui 8 / journey 3 / wireframes 11 / dataModel 9 / scope 12 / KPI 5 — すべて CC 側と一致 |
| `ooui` 保存後のナビ自動再生成 | ✅ 本体側で 6 件が再導出された |
| `mvpStatement` / 北極星指標 / ブランド | ✅ 保存された |

**書き戻しが上流の不整合を可視化した。** `usecases` の `actorName` が `actors` に無い名前
（「対応スタッフ」7件・「顧客企業」1件）で、本体では該当行の `actorId` が null になった
（12件中 4件しか紐付かない）。zod は各工程を独立に見るのでこれを検出できない。
`_lib.ts` に工程間の整合性チェックを足し、`validate.ts` と `push.ts` の両方で警告するようにした。

> これは書き戻しの不具合ではなく **`usecases` 工程の出力品質の問題**。本体でも同じことは
> 起こり得るが、`actorId` を使っていなかった頃は名前を description に埋めていたため
> 表面化しなかった（§7 発見3 の修正で構造化した結果、見えるようになった）。

---

### 実測（2026-08-03・要望1件で確認）

要望「顧客一覧に業種と対応ステータスで絞り込めるようにしてほしい。あと配色がもう少し明るいほうがいい」
を `mvp-orchestrate` に判断させた結果:

```json
{ "steps": ["wireframe", "brand"], "regeneratePrototype": true, "reply": "…" }
```

- 出力は `orchestratePlanSchema` に準拠
- 既存の wireframe を読んだうえで「対応ステータスの絞り込みは既にあるが業種が無い」と
  差分を特定して `wireframe` を選んでいる。13 工程を全部回さず 2 件に絞れている
- `plan-update.ts` がウェーブ順（brand → wireframe）に展開し、検証・プロトタイプ再生成の
  コマンドまで出す
- `ooui` を選んだ計画では `navigation` が「依存のため追加」として後続に入ることも確認

---

## 8. リスクと対処

| リスク | 対処 |
| --- | --- |
| 構造化出力が保証されない | `validate.ts`（zod）+ 1 回リトライ。Workflow 版でも同じ（成果物はファイルなので `schema` では代替できない。§7 Phase 5 参照） |
| プロンプトの乖離 | 生成方式（§2）。CI で生成物の鮮度チェック |
| 親コンテキストの肥大 | サブエージェントは artifacts をファイル経由で受け渡し、返り値は 1 行サマリのみ |
| 画面生成の失敗 | 本体と同じプレースホルダ＋部分再生成。サニタイズはコード側（`assemble.ts`） |
| モデル差による品質ぶれ | 全工程 sonnet（§7 発見1）。`/mvp-diff` の結果で調整 |
| prompt caching が効かない | サブエージェントはセッションが別なので、本体のような `[system + daisyUI リファレンス + 文脈]` の使い回しができない。実行コストは本体より高くつく（性能ではなくコストの話なので許容） |
| `.mvp/` の混入 | `.gitignore` に追加。プロジェクト成果物は Web 側 DB が正 |

## 9. 判断が要る残件

- **`.mvp/` の置き場所** — リポジトリ内（`.gitignore`）か、`~/.mvp/` などリポジトリ外か。複数プロジェクトを跨いで使うなら後者。
- **エージェント追加時の再起動** — エージェント定義はセッション開始時に読み込まれる。`pnpm gen:skill` で
  新しいエージェントが増えても、そのセッションからは `subagent_type` として見えない。
  生成物をコミットしてあるので通常は問題にならないが、`step-specs.ts` に工程を足したときは要注意。
- **ブリーフ / 提案デッキ** — 今回スコープ外だが、`generateDesignBrief` / `generateEngineerBrief` / `deck.ts` は同じ写像で足せる（工程を 3 つ増やすだけ）。
- **「本実装」変換（`realizePrototypeHtml`）** — LQ SDK 前提なので Claude Code 単体では意味が薄い。Claude Code なら「プロトタイプ → 実際の Next.js アプリを書く」に置き換える方が自然。別設計とする。
