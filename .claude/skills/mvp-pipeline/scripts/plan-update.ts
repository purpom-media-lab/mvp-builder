/**
 * mvp-orchestrate が書いた計画（update-plan.json）を、実行順に展開して表示する。
 *
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/plan-update.ts <projectDir>
 *
 * やることは 2 つだけ:
 *  - 工程を**ウェーブ単位**にまとめる（同一ウェーブは 1 メッセージで並列起動できる）
 *  - `ooui` を選んだときに `navigation` を後続へ足す（本体と同じ規則。normalizeSteps）
 *
 * 判断そのものはエージェント側（mvp-orchestrate）の仕事で、ここは並べ替えるだけ。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeSteps } from "../../../../src/lib/ai/orchestrate-spec";
import { STEP_SPECS, WAVES } from "../../../../src/lib/ai/step-specs";
import type { StepKey } from "../../../../src/lib/projects";
import { SCRIPTS, usage } from "./_lib";

const [projectDir] = process.argv.slice(2);

if (!projectDir) {
  console.error(usage("plan-update.ts", "<projectDir>"));
  process.exit(2);
}

const planFile = join(projectDir, "update-plan.json");
if (!existsSync(planFile)) {
  console.error(
    `${planFile} が無い。先に mvp-orchestrate を起動して計画を立てること。`,
  );
  process.exit(1);
}

interface UpdatePlan {
  steps?: StepKey[];
  regeneratePrototype?: boolean;
  reply?: string;
}

let plan: UpdatePlan;
try {
  plan = JSON.parse(readFileSync(planFile, "utf8")) as UpdatePlan;
} catch (e) {
  console.error(`${planFile} を JSON として読めない: ${(e as Error).message}`);
  process.exit(1);
}

const unknown = (plan.steps ?? []).filter((s) => !(s in STEP_SPECS));
if (unknown.length) {
  console.error(`計画に未知の工程が入っている: ${unknown.join(", ")}`);
  process.exit(1);
}

const steps = normalizeSteps(plan.steps ?? []);

if (plan.reply) console.log(`${plan.reply}\n`);

if (!steps.length) {
  console.log("再実行する工程なし。");
  if (plan.regeneratePrototype) {
    console.log(
      `プロトタイプのみ作り直す:\n  pnpm exec tsx ${SCRIPTS}/plan-screens.ts ${projectDir}`,
    );
  }
  process.exit(0);
}

// 依存を満たす範囲でまとめて起動できるよう、ウェーブ単位に落とす。
const groups = WAVES.map((wave) => wave.filter((s) => steps.includes(s))).filter(
  (w) => w.length,
);

const requested = new Set(plan.steps ?? []);
const added = steps.filter((s) => !requested.has(s));

console.log(`再実行する工程: ${steps.length} 件`);
if (added.length) {
  console.log(`（依存のため追加: ${added.join(" / ")}）`);
}
console.log();
groups.forEach((wave, i) => {
  const label = wave
    .map((s) => `${s}（${STEP_SPECS[s].label}）`)
    .join(" / ");
  console.log(
    `${i + 1}. ${label}${wave.length > 1 ? "  ← 1メッセージでまとめて起動" : ""}`,
  );
});

console.log(`\n各ウェーブのあとに検証:`);
console.log(
  `  pnpm exec tsx ${SCRIPTS}/validate.ts ${projectDir} ${steps.join(" ")}`,
);

if (plan.regeneratePrototype) {
  console.log(`\n分析が終わったらプロトタイプを作り直す:`);
  console.log(`  pnpm exec tsx ${SCRIPTS}/plan-screens.ts ${projectDir}`);
  console.log(
    `  ※ 画面名を指定すればその画面だけ作り直せる（ナビが変わっていなければ他は再利用される）`,
  );
} else {
  console.log(`\nプロトタイプの再生成は不要（計画の regeneratePrototype が false）。`);
}
