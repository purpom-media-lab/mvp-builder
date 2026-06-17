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
  dataModelSchema,
  journeySchema,
  navigationSchema,
  oouiSchema,
  orchestratePlanSchema,
  useCasesSchema,
  wireframeSchema,
} from "./schemas";

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
    system:
      "あなたはMVP Builderのオーケストレーターです。ユーザーの要望と現在の分析状態を踏まえ、最適なUIを再提案するために、どの分析工程(actors/usecases/ooui/navigation/wireframe/backend)を再実行すべきか、プロトタイプ(UI)を作り直すべきかを判断します。工程の依存順は actors→usecases→ooui→navigation→wireframe→backend。navigation はメインナビ(画面/メニュー構成)、wireframe は各画面のセクション構成(レイアウト)の設計です。画面構成・メニューの変更要望では navigation を、画面内のレイアウト・要素配置の変更要望では wireframe を選びます。要望に関係する最小限の工程だけ選んでください。UIの見た目・画面構成の変更を伴うなら regeneratePrototype を true にします。",
    prompt: `## 現在の分析状態\n${context}\n\n## ユーザー要望\n${message}`,
  });
}

/** アクター整理 */
export function generateActors({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: actorsSchema,
    provider,
    modelId,
    system:
      "あなたはOOUI/要件分析の専門家です。与えられた事業情報から登場アクターを過不足なく抽出し整理してください。",
    prompt: context,
  });
}

/** ユースケース書き出し */
export function generateUseCases({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: useCasesSchema,
    provider,
    modelId,
    system:
      "あなたはOOUI/要件分析の専門家です。各アクターが達成したい目的をユースケースとして書き出してください。",
    prompt: context,
  });
}

/** OOUI分析（オブジェクト抽出） */
export function generateOoui({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: oouiSchema,
    provider,
    modelId,
    system:
      "あなたはOOUIの専門家です。ユースケースから名詞=オブジェクト、動詞=アクションを抽出し、コレクションと関係を整理してください。オブジェクト名（name）と関係の種別（relations.type）は必ず日本語で命名してください（例: 「リード」「営業担当」「保有する」）。属性（attributes）とアクション（actions）は英語の識別子のままで構いません。",
    prompt: context,
  });
}

/** ジャーニー整理 */
export function generateJourney({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: journeySchema,
    provider,
    modelId,
    system:
      "あなたはUXデザイナーです。アクターとユースケースから主要なユーザージャーニーを整理してください。各ジャーニーは name と、step（行動）・touchpoint（接点）・emotion（感情）を持つステップ列で表現します。日本語で。",
    prompt: context,
  });
}

/** ナビゲーション設計（メインナビ） */
export function generateNavigation({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: navigationSchema,
    provider,
    modelId,
    system:
      "あなたはOOUI/情報設計の専門家です。OOUIオブジェクトとアクターから、アプリのメインナビゲーション（トップ階層の画面/メニュー）を設計してください。原則: コレクション系オブジェクトはメインナビ項目(list)に、集約・横断ビューは dashboard に、単一オブジェクトは原則メインナビに置かず一覧からの遷移先(detail)とする。アクターが複数いる場合は主要アクターが日常的に使う画面を優先。項目数は5〜8個程度に絞り、必要なら2階層まで(parentで表現)。label は日本語。",
    prompt: context,
  });
}

/** ワイヤーフレーム設計（画面ごとのセクション構成） */
export function generateWireframes({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: wireframeSchema,
    provider,
    modelId,
    system:
      "あなたはUIデザイナーです。ナビゲーション（メインナビ）とOOUIオブジェクトをもとに、各画面の低忠実度ワイヤーフレーム（画面ごとのセクション構成）を設計してください。ナビの各メニューを1画面とし、画面種別に応じてセクションを上から順に並べます（例: 一覧=ツールバー+テーブル/カード、ダッシュボード=KPI+チャート、詳細=ヘッダー+詳細フォーム+関連一覧）。label と items は日本語。各画面3〜6セクション程度に。",
    prompt: context,
  });
}

/** データ設計（データエンティティ抽出） */
export function generateDataModel({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: dataModelSchema,
    provider,
    modelId,
    system:
      "あなたはデータモデラーです。OOUIオブジェクトとワイヤーフレームから、永続化に必要なデータエンティティを設計してください。各エンティティに fields（name=英語の識別子, type=データ型）と relations（to=関連先エンティティ名, type=関係種別・日本語）を付与します。",
    prompt: context,
  });
}

/** バックエンド要否判定 */
export function generateBackendSpec({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: backendSpecSchema,
    provider,
    modelId,
    system:
      "あなたはソフトウェアアーキテクトです。このMVPに認証・ストレージ・DB・外部APIが必要かを判定し、理由を述べてください。",
    prompt: context,
  });
}
