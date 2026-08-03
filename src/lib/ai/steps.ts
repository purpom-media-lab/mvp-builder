/**
 * OOUI パイプラインの工程別ジェネレータ（例）
 *
 * 各工程は選択された provider/model で構造化生成する。
 * UI/API から provider を渡すことで Claude/OpenAI/Gemini を切り替えられる。
 */
import { generateStructured } from "./generate";
import type { LlmProvider } from "./models";
import {
  actorsSchema,
  backendSpecSchema,
  brandSchema,
  dataModelSchema,
  designBriefSchema,
  engineerBriefSchema,
  growthSchema,
  journeySchema,
  kpiSchema,
  marketSchema,
  navigationSchema,
  oouiSchema,
  orchestratePlanSchema,
  scopeSchema,
  useCasesSchema,
  wireframeSchema,
} from "./schemas";
import { ORCHESTRATE_SYSTEM } from "./orchestrate-spec";
import { STEP_SPECS } from "./step-specs";

interface StepArgs {
  context: string; // 資料要約など、これまでの成果物をまとめたコンテキスト
  provider?: LlmProvider;
  modelId?: string;
}

/** チャット要望 → どの工程を再実行するかの計画を立てる（オーケストレーター） */
export function planOrchestration({
  context,
  message,
  provider,
  modelId,
}: StepArgs & { message: string }) {
  return generateStructured({
    schema: orchestratePlanSchema,
    provider,
    modelId,
    temperature: 0.2,
    system: ORCHESTRATE_SYSTEM,
    prompt: `## 現在の分析状態\n${context}\n\n## ユーザー要望\n${message}`,
  });
}

/** アクター整理 */
export function generateActors({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: actorsSchema,
    provider,
    modelId,
    system: STEP_SPECS.actors.system,
    prompt: context,
  });
}

/** ユースケース書き出し */
export function generateUseCases({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: useCasesSchema,
    provider,
    modelId,
    system: STEP_SPECS.usecases.system,
    prompt: context,
  });
}

/** OOUI分析（オブジェクト抽出） */
export function generateOoui({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: oouiSchema,
    provider,
    modelId,
    system: STEP_SPECS.ooui.system,
    prompt: context,
  });
}

/** ジャーニー整理 */
export function generateJourney({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: journeySchema,
    provider,
    modelId,
    system: STEP_SPECS.journey.system,
    prompt: context,
  });
}

/** 市場・競合分析（市場規模・競合マップ・参入余地） */
export function generateMarket({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: marketSchema,
    provider,
    modelId,
    system: STEP_SPECS.market.system,
    prompt: context,
  });
}

/** ナビゲーション設計（メインナビ） */
export function generateNavigation({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: navigationSchema,
    provider,
    modelId,
    system: STEP_SPECS.navigation.system,
    prompt: context,
  });
}

/** ワイヤーフレーム設計（画面ごとのセクション構成） */
export function generateWireframes({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: wireframeSchema,
    provider,
    modelId,
    system: STEP_SPECS.wireframe.system,
    prompt: context,
  });
}

/** データ設計（データエンティティ抽出） */
export function generateDataModel({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: dataModelSchema,
    provider,
    modelId,
    system: STEP_SPECS.datamodel.system,
    prompt: context,
  });
}

/** バックエンド要否判定 */
export function generateBackendSpec({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: backendSpecSchema,
    provider,
    modelId,
    system: STEP_SPECS.backend.system,
    prompt: context,
  });
}

/** スコープ確定（探索プロトタイプで提示した全機能から、MVPで作る10個以下を選別） */
export function generateScope({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: scopeSchema,
    provider,
    modelId,
    system: STEP_SPECS.scope.system,
    prompt: context,
  });
}

/** KPI設定（北極星指標・補助KPI） */
export function generateKpi({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: kpiSchema,
    provider,
    modelId,
    system: STEP_SPECS.kpi.system,
    prompt: context,
  });
}

/** グロース計画（KPIを伸ばす計画。独立工程） */
export function generateGrowth({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: growthSchema,
    provider,
    modelId,
    system: STEP_SPECS.growth.system,
    prompt: context,
  });
}

/** デザイナー連携: リファイン依頼の「依頼項目（デザインブリーフ）」を下書きする */
export function generateDesignBrief({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: designBriefSchema,
    provider,
    modelId,
    temperature: 0.4,
    system:
      "あなたはプロダクトデザインのディレクターです。完成したMVPプロトタイプとプロジェクトの分析結果（ブランド/スコープ/アクター/ユースケース/ナビゲーション/ワイヤー）をもとに、外部のデザイナーにUIのブラッシュアップ（リファイン）を依頼するための『デザインブリーフ（依頼項目）』を日本語で下書きしてください。\n各項目は具体的かつ簡潔に: productName/overview=プロダクト名と概要、objective=このリファインで何を良くしたいか、targetUsers=ターゲット/ペルソナ（主要アクターから）、scopeScreens=対象画面・スコープ（ナビゲーション/ワイヤーの主要画面から）、brand=配色HEX・トーンマナー・ロゴ方向（ブランド設計から具体的に）、references=参考になりそうなデザインの方向性、constraints=制約（アクセシビリティ/ブランドガイド/技術）、emphasis=特に重視・改善してほしい点、deliverable=成果物形式（figma を既定に）、deadline=納期（不明なら『未定』）。情報が無い項目も、文脈から妥当な推測で具体的に埋めること。",
    prompt: context,
  });
}

/** エンジニア連携: 開発依頼の「依頼項目（エンジニアブリーフ）」を下書きする */
export function generateEngineerBrief({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: engineerBriefSchema,
    provider,
    modelId,
    temperature: 0.3,
    system:
      "あなたは経験豊富なテックリード/ソフトウェアアーキテクトです。完成したMVPプロトタイプとプロジェクトの分析・設計結果（スコープ/データ設計/バックエンド要否/ナビゲーション/ワイヤー/KPI 等）をもとに、外部のエンジニアにMVPの実装を依頼するための『開発依頼（開発仕様書/チケット）』を日本語で下書きしてください。\nMVPを実際にコードへ落とし込めるよう、実務的で具体的に書きます。各項目: productName=プロダクト名、overview=背景・目的、functionalRequirements=機能要件（MVPスコープに含む機能を実装単位で。箇条書き・改行区切り）、screens=主要画面（ナビゲーション/ワイヤーから）、dataModel=データ設計（主要エンティティと関係。データ設計工程から）、apiEndpoints=主要API（想定エンドポイント。例: POST /leads）、nonFunctional=非機能要件（認証/権限/性能/セキュリティ。バックエンド要否判定を踏まえる）、suggestedStack=推奨技術スタック（フロント/バック/DB/インフラ。MVP前提で現実的に）、milestones=マイルストーン/フェーズ、acceptanceCriteria=受け入れ条件、deliverable=成果物形式（repo を既定に）、deadline=納期（不明なら『未定』）。情報が無い項目も、文脈から妥当な推測で具体的に埋めること。",
    prompt: context,
  });
}

/** ブランド設計（配色・トーン・タイポ等） */
export function generateBrand({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: brandSchema,
    provider,
    modelId,
    system: STEP_SPECS.brand.system,
    prompt: context,
  });
}
