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
  growthSchema,
  journeySchema,
  kpiSchema,
  navigationSchema,
  oouiSchema,
  orchestratePlanSchema,
  scopeSchema,
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
      "あなたは LEAN QUEST AI のオーケストレーターです。ユーザーの要望と現在の分析状態を踏まえ、最適なUIを再提案するために、どの分析工程(actors/usecases/ooui/journey/navigation/wireframe/datamodel/backend/scope/kpi/brand)を再実行すべきか、プロトタイプ(UI)を作り直すべきかを判断します。工程の依存順は actors→usecases→ooui→journey→navigation→wireframe→datamodel→backend→scope→kpi→brand。navigation はメインナビ(画面/メニュー構成)、wireframe は各画面のセクション構成(レイアウト)の設計です。scope は機能候補をMVPに絞り込むスコープ確定、kpi は成功指標(KPI)設計、brand はブランド設計(配色・トーン等)です。画面構成・メニューの変更要望では navigation を、画面内のレイアウト・要素配置の変更要望では wireframe を、MVPで作る機能の取捨選択の要望では scope を、成功指標の要望では kpi を、世界観・配色・トーンの要望では brand を選びます。要望に関係する最小限の工程だけ選んでください。UIの見た目・画面構成の変更を伴うなら regeneratePrototype を true にします。",
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
      "あなたはOOUIの専門家です。ユースケースから名詞=オブジェクト、動詞=アクションを抽出し、コレクションと関係を整理してください。オブジェクト名（name）と関係の種別（relations.type）は必ず日本語で命名してください（例: 「リード」「営業担当」「保有する」）。属性（attributes）とアクション（actions）は、それぞれ name=英語の識別子（例: leadScore, createLead）と label=日本語の表示名（例: 確度スコア, リードを作成）を**両方**付与してください。",
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
      "あなたは情報設計の専門家です。【ユースケース起点】でアプリのメインナビゲーション（トップ階層の画面/メニュー）を設計してください。手順と原則: (1) まず主要ユースケース（各アクターが達成したい目的・タスク）を洗い出す。(2) 1画面=ユーザーのタスクのまとまり、とし、関連するユースケースは同じ画面にまとめる。各主要ユースケースが最短で実行できる入口（画面/メニュー）を必ず用意する。(3) 各ナビ項目に、それが扱う主オブジェクト(targetObject)と画面種別(screenType: list/dashboard/detail/form 等)を割り当てる。コレクション操作は list、横断的に状況把握するユースケースは dashboard、入力タスクは form。(4) label は日本語で『ユーザーがやりたいこと（タスク）』が伝わる命名にする（単なるオブジェクト名の羅列にしない）。(5) 主要アクターが日常的に行うユースケースを上位に優先。項目数は5〜8個に絞り、必要なら2階層まで(parentで表現)。",
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
      "あなたはUIデザイナーです。【各画面が担うユースケースを起点に】、ナビゲーションの各画面の低忠実度ワイヤーフレーム（セクション構成）を設計してください。手順: (1) その画面が対応するユースケース（ユーザーのタスク）を特定する。(2) そのタスクを完了するために必要な要素を、操作の流れに沿って上から順にセクションとして並べる（例: 対象を探すタスク=ツールバー(検索/絞り込み)+テーブル/カード、状況把握タスク=KPI+チャート、確認・操作タスク=ヘッダー+詳細+アクション+関連一覧、入力タスク=フォーム）。(3) 各画面が『そのユースケースを実際に最後まで達成できる』構成になっているか確認する。label と items は日本語。各画面3〜6セクション程度に。",
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

/** スコープ確定（機能候補をMVPで作るべき10個以下に絞り込む） */
export function generateScope({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: scopeSchema,
    provider,
    modelId,
    system:
      "あなたは新規事業のプロダクトマネージャーです。これまでのユースケース/OOUI/ジャーニーから機能候補を洗い出し、各機能を影響度(impact 1-5)と実装工数(effort 1-5)で評価し、MVPで最初に作るべき機能を10個以下に絞り込みます。さらに各機能を3つの判断軸で見積もってください: initialCost=初期開発コスト（日本円。例: 30〜50万円）、operationCost=運用コスト（継続運用の金額・時間。例: 月3万円+月5時間）、learningCost=顧客の学習コスト（ユーザーが使い方を習得する負担。例: 低/中/高）。includedInMvp で MVPに含むか明示し、絞り込みの理由(rationale)を述べてください。mvpStatement に『このMVPで検証する仮説と提供価値』を1-2文で。",
    prompt: context,
  });
}

/** KPI設定（北極星指標・補助KPI） */
export function generateKpi({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: kpiSchema,
    provider,
    modelId,
    system:
      "あなたはグロース/事業計画の専門家です。確定したMVPスコープに紐づく成功指標を設計します。北極星指標(northStar)を1つ、補助KPI(supporting)を3〜5個。各指標に定義/目標値(target)/単位(unit)/計測方法(measurement)/計測頻度(cadence)を日本語で。",
    prompt: context,
  });
}

/** グロース計画（KPIを伸ばす計画。独立工程） */
export function generateGrowth({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: growthSchema,
    provider,
    modelId,
    system:
      "あなたはグロース戦略の専門家です。確定したKPIを伸ばすためのグロース計画を設計します。model=どうやって成長を生むか（グロースモデル/ループ）、levers=主要なグロースレバー、experiments=優先度順の施策/実験(3〜5個、仮説hypothesis・動かす指標metric・工数effortを付与)、milestones=【四半期ごとにざっくり】。period は『Q1』『Q2』…のように四半期で、target にその四半期の到達目標を、3〜4四半期分・時系列で。細かい月次にはせず四半期単位の大枠でよい。KPIと一貫させ、すべて日本語で。",
    prompt: context,
  });
}

/** ブランド設計（配色・トーン・タイポ等） */
export function generateBrand({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: brandSchema,
    provider,
    modelId,
    system:
      "あなたはブランドデザイナーです。事業の世界観・ターゲット・価値から、プロダクトのブランドを設計します。配色は必ずHEXカラーコードで具体的に(primary必須、secondary/accent/neutral/background)。\n【重要】配色は1案でなく『複数案(paletteOptions)を3つ』提示してください。各案は方向性が異なり(例: 信頼感のネイビー系 / 先進的なバイオレット系 / 親しみのあるコーラル系)、それぞれにコンセプト名(name)を付けます。palette には3案のうち最も推奨する案を入れます。\nトーン(tone)を形容詞配列で、タイポ方向(typography.heading/body)、ロゴ方向(logoDirection)、イメージ語(imageryKeywords)、ボイス(voice)を日本語で提示。",
    prompt: context,
  });
}
