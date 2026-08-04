// 自動生成: scripts/gen-claude-skill.ts が src/lib/ai/step-specs.ts から生成。手で編集しない。
export const meta = {
  "name": "mvp-pipeline",
  "description": "13工程をウェーブ並列で回し、ウェーブごとの検証と作り直しまで決定的に行う。プロトタイプ生成まで含む。",
  "whenToUse": "分析からプロトタイプまでを一息に通したいとき。日常の部分的な操作は /mvp-run /mvp-step /mvp-proto を使う。",
  "phases": [
    {
      "title": "Wave 1",
      "detail": "アクター整理"
    },
    {
      "title": "Wave 2",
      "detail": "ユースケース書き出し"
    },
    {
      "title": "Wave 3",
      "detail": "ジャーニー整理"
    },
    {
      "title": "Wave 4",
      "detail": "市場・競合分析"
    },
    {
      "title": "Wave 5",
      "detail": "OOUI分析（オブジェクト抽出） / スコープ確定 / ブランド設計"
    },
    {
      "title": "Wave 6",
      "detail": "ナビゲーション設計（メインナビ） / データ設計 / KPI設定"
    },
    {
      "title": "Wave 7",
      "detail": "ワイヤーフレーム設計 / バックエンド要否判定 / グロース計画"
    },
    {
      "title": "検証",
      "detail": "スキーマ検証と、失敗した工程の作り直し"
    },
    {
      "title": "プロトタイプ",
      "detail": "画面の確定 → 並列生成 → 組み立て"
    }
  ]
}

const WAVES = [["actors"],["usecases"],["journey"],["market"],["ooui","scope","brand"],["navigation","datamodel","kpi"],["wireframe","backend","growth"]]
const LABELS = {"actors":"アクター整理","usecases":"ユースケース書き出し","journey":"ジャーニー整理","market":"市場・競合分析","ooui":"OOUI分析（オブジェクト抽出）","scope":"スコープ確定","brand":"ブランド設計","navigation":"ナビゲーション設計（メインナビ）","datamodel":"データ設計","kpi":"KPI設定","wireframe":"ワイヤーフレーム設計","backend":"バックエンド要否判定","growth":"グロース計画"}
const SCRIPTS = ".claude/skills/mvp-pipeline/scripts"

// projectDir は args で受け取る。例: { projectDir: ".mvp/lead-crm" }
const projectDir = typeof args === "string" ? args : args?.projectDir
if (!projectDir) {
  throw new Error(
    'projectDir を渡すこと。例: args = { projectDir: ".mvp/lead-crm" }。' +
      "project.json（name/summary/analysisResult）は先に用意しておくこと。",
  )
}

const VALIDATION = {
  type: "object",
  properties: {
    ok: { type: "boolean", description: "全工程が OK なら true" },
    failures: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "string", description: "工程キー" },
          detail: { type: "string", description: "validate.ts が出したエラー明細" },
        },
        required: ["step", "detail"],
      },
    },
  },
  required: ["ok", "failures"],
}

/** validate.ts を実行し、結果を構造化して返す。 */
function validate(steps, phaseName) {
  const cmd = "pnpm exec tsx " + SCRIPTS + "/validate.ts " + projectDir + " " + steps.join(" ")
  return agent(
    "次のコマンドを実行し、出力をそのまま構造化して返してください。\n\n  " + cmd + "\n\n" +
      "INVALID / MISSING の行があれば ok=false とし、工程ごとのエラー明細を failures に入れる。" +
      "「⚠ 工程間の整合性」は警告であって失敗ではないので failures に入れない。",
    { label: "validate:" + phaseName, phase: "検証", schema: VALIDATION, effort: "low" },
  )
}

/** 1工程を実行する。detail があれば「直し」として渡す。 */
function runStep(step, detail) {
  const base =
    "projectDir = " + projectDir +
    "\nこの工程を実行して artifacts/" + step + ".json を書き出してください。"
  const prompt = detail
    ? base + "\n\n前回の出力はスキーマ検証を通りませんでした。次の指摘を直して書き直してください。\n" + detail
    : base
  return agent(prompt, { agentType: "mvp-" + step, label: step })
}

// --- 13工程（ウェーブ並列 → 検証 → 1回だけ作り直し） ----------------------

for (let i = 0; i < WAVES.length; i++) {
  const wave = WAVES[i]
  const name = "Wave " + (i + 1)
  phase(name)
  await parallel(wave.map((step) => () => runStep(step)))

  const result = await validate(wave, name)
  if (result && !result.ok && result.failures && result.failures.length) {
    const names = result.failures.map((f) => LABELS[f.step] || f.step).join(" / ")
    log(name + ": " + names + " がスキーマ検証を通らなかった。作り直す。")
    phase(name)
    await parallel(result.failures.map((f) => () => runStep(f.step, f.detail)))
    const retry = await validate(wave, name + "-retry")
    if (retry && !retry.ok) {
      // 2回目も通らなければ止める（手で JSON を書き換えない）。
      return {
        stoppedAt: name,
        failures: retry.failures,
        hint: "該当工程の指示（step-specs.ts）かスキーマを見直すこと。",
      }
    }
  }
}

// --- プロトタイプ ---------------------------------------------------------

phase("プロトタイプ")

const PLAN = {
  type: "object",
  properties: {
    indexes: {
      type: "array",
      items: { type: "number" },
      description: "「生成」と表示された画面番号",
    },
    needsTheme: { type: "boolean", description: "テーマを生成すると出ていたか" },
  },
  required: ["indexes", "needsTheme"],
}

const plan = await agent(
  "次を実行し、出力を構造化して返してください。\n\n  pnpm exec tsx " +
    SCRIPTS + "/plan-screens.ts " + projectDir + "\n\n" +
    "「生成」と表示された画面番号を indexes に入れる（「再利用」は入れない）。",
  { label: "plan-screens", phase: "プロトタイプ", schema: PLAN, effort: "low" },
)

if (plan && plan.indexes && plan.indexes.length) {
  const jobs = plan.indexes.map(
    (i) => () =>
      agent("projectDir = " + projectDir + "\n画面番号 = " + i, {
        agentType: "mvp-screen",
        label: "screen:" + i,
        phase: "プロトタイプ",
      }),
  )
  if (plan.needsTheme) {
    jobs.push(() =>
      agent("projectDir = " + projectDir, {
        agentType: "mvp-theme",
        label: "theme",
        phase: "プロトタイプ",
      }),
    )
  }
  await parallel(jobs)
}

const assembled = await agent(
  "次を実行し、出力をそのまま返してください。\n\n  pnpm exec tsx " +
    SCRIPTS + "/assemble.ts " + projectDir,
  { label: "assemble", phase: "プロトタイプ", effort: "low" },
)

return {
  projectDir,
  prototype: projectDir + "/prototype/index.html",
  assembled,
}
