/**
 * `<projectDir>/artifacts/*.json` を本体と同じ Zod スキーマで検証する。
 *
 *   pnpm exec tsx .claude/skills/mvp-pipeline/scripts/validate.ts <projectDir> [step ...]
 *
 * step を省略すると、存在する成果物すべてを検証する。
 * 不正な成果物が1つでもあれば exit 1。エラーは「どのパスがどう違うか」まで出す
 * （サブエージェントにそのまま渡して直させるため）。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STEP_SPECS, STEP_ORDER } from "../../../../src/lib/ai/step-specs";
import { crossCheckArtifacts, formatZodIssues, usage } from "./_lib";
import type { StepKey } from "../../../../src/lib/projects";

const [projectDir, ...rest] = process.argv.slice(2);

if (!projectDir) {
  console.error(usage("validate.ts", "<projectDir> [step ...]"));
  process.exit(2);
}

const requested = rest.filter((s): s is StepKey => s in STEP_SPECS);
const unknown = rest.filter((s) => !(s in STEP_SPECS));
if (unknown.length) {
  console.error(`unknown step(s): ${unknown.join(", ")}`);
  process.exit(2);
}

const targets: StepKey[] = requested.length ? requested : STEP_ORDER;

let invalid = 0;
let missing = 0;
let ok = 0;

for (const step of targets) {
  const file = join(projectDir, "artifacts", `${step}.json`);
  const label = STEP_SPECS[step].label;

  if (!existsSync(file)) {
    // 明示指定された工程だけ「無い」を失敗として扱う（全件モードでは未実行を許す）。
    if (requested.length) {
      console.log(`MISSING  ${step} (${label}) — ${file} が無い`);
      missing++;
    }
    continue;
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    invalid++;
    console.log(
      `INVALID  ${step} (${label}) — JSON として読めない: ${(e as Error).message}`,
    );
    continue;
  }

  const result = STEP_SPECS[step].schema.safeParse(data);
  if (result.success) {
    ok++;
    console.log(`OK       ${step} (${label})`);
    continue;
  }

  invalid++;
  console.log(`INVALID  ${step} (${label}) — ${file}`);
  for (const line of formatZodIssues(result.error.issues)) console.log(line);
}

// 工程をまたぐ参照の整合性（zod では表せない）。落とさず警告に留める。
const warnings = crossCheckArtifacts((step) => {
  const f = join(projectDir, "artifacts", `${step}.json`);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
});
if (warnings.length) {
  console.log("\n⚠ 工程間の整合性");
  for (const w of warnings) console.log(w);
}

console.log(
  `\nok=${ok} invalid=${invalid}${requested.length ? ` missing=${missing}` : ""}${warnings.length ? " warnings=1" : ""}`,
);
process.exit(invalid + missing > 0 ? 1 : 0);
