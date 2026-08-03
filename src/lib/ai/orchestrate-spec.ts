/**
 * 要望反映（オーケストレーション）の仕様。
 *
 * 「ユーザーの要望に対して、どの工程を再実行し、プロトタイプを作り直すか」の
 * 判断基準を 1 箇所に置く。参照元は 2 系統:
 *
 *  - `steps.ts` の `planOrchestration()` … Web アプリ本体（generateObject）
 *  - `scripts/gen-claude-skill.ts`       … Claude Code 用の mvp-orchestrate エージェント
 *
 * step-specs.ts / theme-spec.ts と同じ「仕様は1箇所・実行は別」の作法。
 * 依存は zod のみ（生成スクリプトから AI SDK を引き込まないため）。
 */
import type { StepKey } from "../projects";
import { STEP_ORDER } from "./step-specs";

export const ORCHESTRATE_SYSTEM =
  "あなたは LEAN QUEST AI のオーケストレーターです。ユーザーの要望と現在の分析状態を踏まえ、最適なUIを再提案するために、どの分析工程(actors/usecases/ooui/journey/market/navigation/wireframe/datamodel/backend/scope/kpi/brand)を再実行すべきか、プロトタイプ(UI)を作り直すべきかを判断します。工程の依存順は actors→usecases→journey→market→ooui→navigation→wireframe→datamodel→backend→scope→kpi→brand。journey はユーザージャーニーマップ(体験の可視化・painは scope に効く)。market は市場規模(TAM/SAM/SOM)・競合分析・参入余地の分析で、市場・競合・差別化に関する要望で選びます。navigation はメインナビ(画面/メニュー構成)、wireframe は各画面のセクション構成(レイアウト)の設計です。scope は機能候補をMVPに絞り込むスコープ確定、kpi は成功指標(KPI)設計、brand はブランド設計(配色・トーン等)です。市場規模・競合・差別化の要望では market を、画面構成・メニューの変更要望では navigation を、画面内のレイアウト・要素配置の変更要望では wireframe を、MVPで作る機能の取捨選択の要望では scope を、成功指標の要望では kpi を、世界観・配色・トーンの要望では brand を選びます。要望に関係する最小限の工程だけ選んでください。UIの見た目・画面構成の変更を伴うなら regeneratePrototype を true にします。";

/**
 * 要求された工程を実行順に正規化する。
 *
 * 規則は 1 つだけ: `ooui`（モデリング）を再実行するときは、ナビゲーションを OOUI から
 * 自動導出し直すため `navigation` を必ず後続に含める。
 *
 * `order` を引数に取るのは、**本体と Claude Code 版で並べ方が違う**ため。
 * 本体（`/api/orchestrate`）は 1 工程ずつ逐次実行するので自前の直列順を持ち、
 * Claude Code 版はウェーブ並列で回すので `STEP_ORDER`（`WAVES.flat()`）に従う。
 * どちらも依存関係は満たしているが順番が同じではないので、片方に寄せると挙動が変わる。
 */
export function normalizeSteps(
  requested: StepKey[],
  order: StepKey[] = STEP_ORDER,
): StepKey[] {
  const set = new Set(requested);
  if (set.has("ooui")) set.add("navigation");
  return order.filter((s) => set.has(s));
}
