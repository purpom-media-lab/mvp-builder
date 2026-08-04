---
name: mvp-pipeline
description: 事業アイデア・要件資料から、OOUI分析〜設計の13工程（アクター/ユースケース/ジャーニー/市場/OOUI/ナビ/ワイヤー/データ設計/バックエンド/スコープ/KPI/グロース/ブランド）を専門ロールのサブエージェントで並列実行し、さらにクリック可能なプロトタイプ（単一HTML）まで生成する。MVP Builder（Webアプリ）と同じプロンプト・同じスキーマ・同じ骨格を使う。「MVPの分析をして」「OOUI分析して」「この資料からMVPを設計して」「プロトタイプを作って」等で使う。
---

# MVP パイプライン（Claude Code 版）

MVP Builder（`src/lib/ai/`）の分析・設計パイプラインを Claude Code で回す。
工程プロンプトとスキーマは `src/lib/ai/step-specs.ts` から機械生成されているので、
**Web アプリ本体と同じ品質・同じ出力形**になる。

## 成果物の置き場所

```
.mvp/<project-slug>/
├── input/            # 入力資料（PDF/テキスト/URL の控え）
├── project.json      # 名前・概要・ジョブ分析（JTBD）
├── artifacts/        # actors.json … brand.json（13ファイル）
├── reference/        # 検証モードのみ: 本体から取得した成果物（分析中は読まない）
└── prototype/
    ├── plan.json     # 生成対象の画面一覧（plan-screens.ts が作る）
    ├── prompts/      # 画面ごとのプロンプト（mvp-screen が読む）
    ├── screens/      # <i>.jsx（mvp-screen が書く）
    ├── theme.json    # daisyUI テーマ（mvp-theme が書く）
    └── index.html    # 完成品（assemble.ts が組み立てる）
```

`<project-slug>` は英小文字・ハイフンで短く（例: `.mvp/lead-crm`）。
以下、このディレクトリを `<projectDir>` と呼ぶ。

## 手順

### 1. 入力を揃える

- PDF は Read でそのまま読む。URL は WebFetch。テキストはそのまま受け取る。
- 資料の控えを `<projectDir>/input/` に保存する（後で再現・差分確認に使う）。

### 2. ジョブ分析（JTBD）— 対話で確定させる

いきなり分析に入らない。ジョブ理論の枠組みで**ユーザーと対話して要望を深掘りする**。

- 誰が、どんな状況で、何を片付けたくてこのプロダクトを「雇う」のか
- 今はどう代替しているか（既存の手段・回避策）、その何が不満か
- それが解決されたらどう嬉しいか（機能ではなく成果で）

不明点があれば必ず質問する。推測で埋めない。**曖昧なまま先に進むと13工程すべてが薄くなる。**
資料が十分に具体的で確認事項が無い場合のみ、この対話を省いてよい。

合意した内容を `<projectDir>/project.json` に書く。

```json
{
  "name": "プロダクト名",
  "summary": "1-2文の概要",
  "analysisResult": "ジョブ分析（JTBDインタビューでユーザーと合意した確定要望）の本文",
  "sourceText": "入力資料の要約または全文（長ければ要約）"
}
```

> `analysisResult` は**入力資料より優先される確定要望**として全工程が参照する。
> 矛盾したときはこちらを正とする。

### 3. 13工程をウェーブ並列で実行

`references/waves.md` を読み、そこに書かれたウェーブ順で実行する。

- **同一ウェーブ内の工程は 1 メッセージで同時に Task を発行する**（並列実行）。逐次にしない。
- 各 Task の `subagent_type` は `mvp-<step>`（例: `mvp-ooui`）。
- 各 Task に渡すプロンプトは `<projectDir>` を伝えるだけでよい。工程の指示はエージェント定義側にある。

  ```
  projectDir = .mvp/lead-crm
  この工程を実行して artifacts/<step>.json を書き出してください。
  ```

- 次のウェーブに進む前に、そのウェーブの成果物を検証する（次項）。

### 4. ウェーブごとに検証する

```bash
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/validate.ts <projectDir> <step> [<step> ...]
```

- `OK` なら次のウェーブへ。
- `INVALID` なら、**そのエージェントに SendMessage で**エラー出力をそのまま渡して直させる
  （新しい Task を立てない。文脈を持ったまま直すほうが速く正確）。
- 2 回直しても通らなければ、そこで止めてユーザーに報告する。勝手に手で JSON を書き換えない。

### 5. 報告

全ウェーブ完了後、`validate.ts` を引数なしで実行して13件すべて `OK` を確認し、
次を短くまとめて報告する。

- MVP ステートメント（`scope.json` の `mvpStatement`）
- OOUI のメインオブジェクトとナビゲーション構成
- MVP に含む機能（`includedInMvp` が true のもの）と、外したものの理由
- 北極星指標

成果物の JSON 本体は貼らない。ファイルパスを示す。

### 6. プロトタイプを生成する

13工程が揃ったら、クリック可能なプロトタイプ（単一 HTML）を作る。
規約と考え方は `references/prototype.md` に書いてある。**先にそれを読む。**

```bash
# ① 生成対象の画面を確定し、画面ごとのプロンプトを書き出す
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/plan-screens.ts <projectDir>
```

```
# ② 出力された画面番号ぶんの mvp-screen を「1メッセージでまとめて」起動する。
#    テーマ生成が必要と出ていれば mvp-theme も同じメッセージに入れる。
#    各 Task に渡すのはこれだけ:
projectDir = .mvp/lead-crm
画面番号 = 3
```

```bash
# ③ 骨格に組み立てる（サニタイズ・採番・テーマ検証はここが行う）
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/assemble.ts <projectDir>
```

- `assemble.ts` が「未生成」「壊れている」と報告した画面は、表示されるコマンドで
  その画面だけ作り直す。**失敗が 0 になるまで繰り返す。**
- 仕上がったら `<projectDir>/prototype/index.html` のパスをユーザーに伝える。
  ブラウザで開いて一覧 → 詳細 → 戻るまで動くか、可能なら自分で確認する。

### 7. 検証モード（本体と突き合わせる）

本体（Web アプリ）の既存プロジェクトを取得し、**同じ入力**で Claude Code 版を回して
出力を比べる。用途は 2 つ: (a) CC 版が本体と同等かの回帰チェック、(b) 本体のプロンプト
改善のネタ出し。

必要な環境変数（ダッシュボードの「Claude Code 連携」で発行）:

```
MVP_BUILDER_MCP_URL   … 例 https://<host>/api/mcp
MVP_BUILDER_MCP_TOKEN … パーソナルトークン
```

```bash
# ① 本体の成果物を取得。入力(project.json)と正解(reference/)に分けて保存される
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/fetch-reference.ts \
  <projectId|studioURL> <projectDir>
```

**取得した `reference/` を分析中に読まないこと。** 本体の答えを見たまま再分析すると
「写す」だけになり、品質比較にならない。入力は `project.json` に切り出されている。

```bash
# ② 手順 3〜4 と同じ要領で13工程を回す（JTBD 対話は不要。analysisResult が入っている）

# ③ 構造差分を出す
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/compare.ts <projectDir>
```

`compare.ts` が出すのは**構造の差だけ**（件数・名前集合・真偽判断）。
どちらが妥当かは判定しないので、**その論評は自分で行う**:

- 数が違う工程はどちらが入力に忠実か（入力に無いものを立てていないか）
- 名前集合の比較は**完全一致**なので、「対応スタッフ」と「事務所スタッフ」のような
  表記ゆれは別物として数えられる。「一致 0」でも中身は同じことがあるので必ず中身を読む
- `backend` の真偽が割れたら、入力のどの記述が根拠になるかを示す

> 既に成果物のある `<projectDir>` に `fetch-reference.ts` を向けると
> `project.json` を上書きしてしまうため、既存があれば止まる（`--force` で強行）。
> 検証用は `.mvp/diff-<slug>` のように別ディレクトリを使うのが安全。

### 8. 本体（Web アプリ）へ書き戻す

Claude Code 側で作った成果物を、本体のプロジェクトへ保存する。studio で閲覧・編集でき、
プロトタイプ生成や提案資料など本体の後続機能にそのまま繋がる。

**書き込み権限つきのトークンが要る。** ダッシュボードの「Claude Code 連携」で
「書き戻しを許可する」にチェックして再発行する（既定は読み取り専用）。

```bash
MVP_BUILDER_MCP_URL=... MVP_BUILDER_MCP_TOKEN=... \
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/push.ts \
  <projectDir> <projectId|studioURL> [step ...]
```

- step を省略すると、揃っている成果物を**依存順**に全部送る
- 本体側は工程ごとに**洗い替え**（既存を消して入れ直す）。**上書きされて困るものが
  本体側にないか、先に studio で確認する**
- 送る前に本体と同じ zod スキーマで検証し、1 件でも不一致なら**何も送らずに中止**する
- 途中で失敗したらそこで止まる（中途半端に混ざった状態を作らない）。何件目まで
  保存済みかを表示するので、直して残りを送り直す
- `ooui` を送るとナビゲーションは本体側で自動再生成される。`navigation` を明示的に
  送っても上書きされる

> **工程間の整合性に注意。** `usecases` の `actorName` が `actors` に無い名前だと、
> 本体では `actorId` が null になり画面遷移図からアクターが消える。`validate.ts` と
> `push.ts` が警告を出すので、出たら先に直す（スキーマ検証だけでは検出できない）。

### 9. 要望を反映する

「リード一覧に絞り込みを足して」のような要望から、**作り直すべき工程だけ**を選んで回す。
判断基準は本体（`planOrchestration`）と共有しているので、Web アプリと同じ選び方になる。

```
# ① mvp-orchestrate に計画を立てさせる（工程を自分で選ばない）
projectDir = .mvp/lead-crm
ユーザーの要望 = 「リード一覧に絞り込みを足して」
```

```bash
# ② 計画をウェーブ順に展開する
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/plan-update.ts <projectDir>
```

出力された順に工程を回す（同一ウェーブは 1 メッセージでまとめて起動）。
各ウェーブのあとに `validate.ts` で検証するのは手順 4 と同じ。

```bash
# ③ 計画が regeneratePrototype: true ならプロトタイプを作り直す
pnpm exec tsx .claude/skills/mvp-pipeline/scripts/plan-screens.ts <projectDir> [画面名 ...]
```

- **実行前にユーザーへ提示する。** 再実行する工程は既存の成果物を洗い替えるので、
  「何を作り直すか」を見せて確認を取る
- `ooui` を作り直すと `navigation` が自動で後続に足される（本体と同じ規則）。
  `plan-update.ts` が「依存のため追加」と表示する
- `steps` が空なら分析は回さない。要望が分析工程に当たらないこともある
  （その場合はエージェントの `reply` をそのまま伝える）
- 影響が画面だけなら、画面名を指定して部分再生成すれば速い

## 単一工程だけ回す

要望や修正で一部だけ作り直すとき:

1. 対象工程を決める。依存の下流（`references/waves.md` で後のウェーブにある工程）も
   内容が変わるなら一緒に作り直す。
2. 該当の `mvp-<step>` エージェントを起動する。
3. 検証する。

## 注意

- `.claude/agents/mvp-*.md` と `references/schemas/*.json`・`references/daisyui.md` は**自動生成**。
  直接編集しない。プロンプトを変えるときは本体を直して `pnpm gen:skill` を実行する
  （Web アプリ本体にも同じ変更が反映される）。生成元は次のとおり:
  - 13工程 … `src/lib/ai/step-specs.ts`
  - `mvp-screen` … `src/lib/prototype-ds/prompt.ts`
  - `mvp-theme` … `src/lib/prototype-ds/theme-spec.ts`
- 工程の実行順を勝手に変えない。ウェーブ順には根拠がある（`references/waves.md` 末尾）。
- `.mvp/` はコミットしない（`.gitignore` 済み）。
- 取りこぼしなく一息に通したいときは Workflow 版（`.claude/workflows/mvp-pipeline.js`）もある。
  ウェーブ並列・検証・作り直しがスクリプトで固定されるが、**起動にユーザーの明示的な
  opt-in が要る**ので、こちらから勝手に使わない。ユーザーが望んだときだけ案内する。
- エージェント定義はセッション開始時に読み込まれる。`pnpm gen:skill` で**新しい**エージェントが
  増えた場合、そのセッションからは `subagent_type` として見えない（`not found` になる）。
  Claude Code を再起動すれば使える。
