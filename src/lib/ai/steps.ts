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
      "あなたはOOUIの専門家です。【ユースケースだけでなく、入力資料・概要・分析結果を含むコンテキスト全体】から、このドメインで扱う名詞=オブジェクトの候補を洗い出し、その中から『メインオブジェクト』を選んで出力してください。\n" +
      "【メインオブジェクトの判定】候補のうち、(a)数えられる名詞である、(b)同種の集合として管理され得る、(c)固有のアクションを持つ、を満たすものをメインオブジェクトとします。多くのオブジェクトと関連する『ハブ』はメインオブジェクトとしての妥当性が高いです。列挙済みのタスク（ユースケース）に明示されていなくても、ドメイン上必要なマスタ系・設定系・参照系のメインオブジェクトは取りこぼさないこと（タスク指向の動詞起点に引きずられない）。\n" +
      "【サブオブジェクトはプロパティに畳む】他オブジェクトを識別・絞り込むためだけの従属的な概念（例: 名前・氏名・電話番号・カテゴリ・タグ・日付・ステータス・所属区分など）は独立したオブジェクトにせず、所属するメインオブジェクトの属性（attributes）として畳んでください。ただしその概念自体に固有の情報や複数の関連オブジェクトを持つ（ハブ性がある）場合はメインオブジェクトに昇格させます。objects 配列にはメインオブジェクトのみを入れてください。\n" +
      "【属性】各オブジェクトには、ユーザーが画面上でインスタンスを識別できるよう『名称／氏名』にあたる属性をほぼ必ず含めてください（一覧の表示名・主キー的役割）。\n" +
      "【アクション】アクションはタスク中の動詞を手掛かりに抽出し、編集可能なオブジェクトには新規作成・削除を補います。ただし『〜を確認する／閲覧する／参照する』はそのオブジェクトを表示すれば足りるため、アクションには含めません。\n" +
      "【関係・多重度】関係には多重度（relations.cardinality。例: 1対多/多対多/1対1）を付け、後続のナビ階層・画面の親子関係・参照方向の判断材料にします。オブジェクト名（name）と関係の種別（relations.type）は必ず日本語で命名してください（例: 「リード」「営業担当」「保有する」）。\n" +
      "【命名規則】属性（attributes）とアクション（actions）は、それぞれ name=英語の識別子（例: leadScore, createLead）と label=日本語の表示名（例: 確度スコア, リードを作成）を**両方**付与してください。",
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
      "あなたはUXデザイナーです。アクターとユースケースから主要なユーザージャーニーを整理してください。各ジャーニーは name と、step（行動）・touchpoint（接点）・emotion（感情）を持つステップ列で表現します。日本語で。なおジャーニーは体験の流れを掴む補助的な UX レンズであり、画面・ナビゲーションの構造を駆動するものではありません（画面構造は ooui のオブジェクトから導出します）。タスクの時系列把握と、後工程での体験の抜け漏れ検証に用います。",
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
      "あなたは OOUI（オブジェクト指向UI）と情報設計の専門家です。【OOUIオブジェクト起点】でアプリのメインナビゲーション（ルートナビ＝トップ階層の画面/メニュー）を設計してください。ユースケースから先に画面を作るのではなく、ooui のオブジェクト構造から画面を導出します。手順と原則: (1) ooui のメインオブジェクト（特に collectionOf を持つ／複数インスタンスを束ねるコレクション、および関連の多い『ハブ』オブジェクト）を特定し、それぞれを『トップ階層の list 画面（入口）』にする。ルートナビには、ユーザーがアプリ利用時に最初に思い浮かべる重要なメインオブジェクトを並べる。(2) 複数オブジェクトを横断して状況把握する必要があれば dashboard をトップに1つ置く。(3) relations（オブジェクト間の関連）と多重度(cardinality)を階層(parent)・参照方向の決定に使う: 1対多の『多』側や従属側（他オブジェクトに保有される/part-of 側）はトップに並べず、親オブジェクトの画面(detail)配下に置く。1対1で従属する相手もトップに出さず、親の detail から相手のシングル(detail)へリンクする。参照は原則シングルビューを起点に、相手が多重なら相手のコレクション、多重でないなら相手のシングルを呼ぶ。(4) 単一インスタンスの詳細(detail)・入力(form)は原則コレクション画面からの遷移とし、トップ階層には主要な入口だけを残す。(5) 各オブジェクト画面が、そのオブジェクトの主要 actions を実行できる入口になっているか確認する。(6) targetObject には ooui の該当オブジェクト名(name)をそのまま使う（表記ゆれ防止）。screenType は list/dashboard/detail/form/other。ユーザーがルートナビ項目を選ぶと、そのオブジェクトのコレクション(list)が開く形を基本とする。(7) label はそのオブジェクト（もの）の名前を基準にした簡潔な日本語にする。『機能』ではなく『もの』が並ぶイメージにし、動詞・機能名は使わない。語尾に『管理／一覧／確認／参照／照会／情報／編集／登録／システム』などの冗長な接尾辞を付けない（例: ×「リード管理」「顧客一覧」→ ○「リード」「顧客」）。項目数は5〜8個に絞り、必要なら2階層まで(parentで表現)。(8) 【検証フェーズ】最後に、主要ユースケース（各アクターのタスク）が、これらのオブジェクト画面の組合せで最後まで達成できるかを点検し、入口が欠けるユースケースがあれば screenType=other 等で最小限だけ補う。ユースケースは設計の起点ではなく『網羅性の検証』に使うこと。",
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
      "あなたは OOUI（オブジェクト指向UI）と UI レイアウトの専門家です。【OOUIオブジェクト起点】で各画面の低忠実度ワイヤーフレーム（セクション構成）を設計してください。ユースケースから先にレイアウトを作るのではなく、ooui のオブジェクト構造（属性・アクション・関係）から各画面の提示を導きます。\n" +
      "手順と原則:\n" +
      "(1) 各 wireframe 画面の targetObject に、その画面が扱う ooui オブジェクト名を設定する（navigation の targetObject と一致させ表記ゆれを防ぐ。横断集約のダッシュボードのみ空可）。画面名(screenName)は navigation の対応メニュー名(label)と一致させ、screenType も navigation の対応画面に合わせる（screenType は navigation を正とする）。\n" +
      "(2) 【コレクション/シングルの対】主要オブジェクトには原則 list（コレクション）画面と detail（シングル）画面の両方を用意する。ナビのトップに detail が出ていなくても、コレクションから遷移する detail 画面をここで設計する。\n" +
      "(3) list（コレクション）画面: そのオブジェクトの主要『属性(attributes)』を列にした table または cards を中心に置く。さらにオブジェクトの性質・主タスクに応じて表示形式を選ぶ（時間軸が主役なら calendar/timeline、位置情報が主役なら map）。上部にはコレクション操作の toolbar（検索/絞り込み/並び替え/グルーピング＋新規作成などのコレクション系 action）を置く。\n" +
      "(4) detail（シングル）画面: 1インスタンスの『属性(attributes)』を提示する detail/header を置き、そのオブジェクトの『アクション(actions)』をアクション群（ボタン）として配置する。relations 先は多重度に従って載せる: 相手が多重（1対多/多対多）なら『関連コレクション一覧』(table/list)として、1対1なら相手の詳細へのリンク/サマリとして載せる。\n" +
      "(5) dashboard 画面: 複数オブジェクトを横断する KPI/chart/list を集約する。\n" +
      "(6) 各セクションの items には、ooui の属性 label / アクション label / 関連オブジェクト名など、実際の名詞・操作名を日本語で具体的に入れる（汎用語の羅列にしない）。\n" +
      "(7) 【レイアウトパターン】各画面に layoutPattern を設定する: stack=画面遷移（コレクション→シングルを画面切替。モバイルや、オブジェクト同士が相互参照してループする場合に向く）、master-detail=2ペイン（左にコレクション・右にシングルを同時表示。広い画面で横断呼び出しがループしない場合に向く）、grid=ダッシュボード等の集約グリッド、single=フォーム等の単一ビュー。セクションの並びは『左で選んだ結果が右に出る／上の操作結果が下に反映される』方向性に従い、master-detail ではコレクション系セクションを先（左/上）、detail/form 系を後（右/下）に配置する。\n" +
      "(8) 【検証フェーズ】最後に、各アクターの主要ユースケース（タスク）が、これらのオブジェクト画面の組合せで最後まで達成できるかを点検し、不足があれば最小限だけ補う。ユースケースは設計の起点ではなく『網羅性の検証』に使う。\n" +
      "screenName と label と items は日本語。各画面3〜6セクション程度に。",
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
      "あなたはデータモデラーです。OOUIオブジェクト（その属性・関係・多重度）を主な入力に、永続化に必要なデータエンティティを設計してください。OOUIオブジェクトの属性をフィールドへ、関係・多重度を外部キー/中間テーブル等のデータ関係へ写像します。各エンティティに fields（name=英語の識別子, type=データ型）と relations（to=関連先エンティティ名, type=関係種別・日本語）を付与します。",
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

/** スコープ確定（探索プロトタイプで提示した全機能から、MVPで作る10個以下を選別） */
export function generateScope({ context, provider, modelId }: StepArgs) {
  return generateStructured({
    schema: scopeSchema,
    provider,
    modelId,
    system:
      "あなたは新規事業のプロダクトマネージャーです。**探索プロトタイプで提示された画面・ナビゲーション・機能（MVPに絞らず全機能を含む探索版）を起点に**、そこに現れた機能候補を洗い出し、各機能を影響度(impact 1-5)と実装工数(effort 1-5)で評価し、**プロトタイプで見えた機能の中から** MVPで最初に作るべき機能を10個以下に絞り込みます。プロトタイプに無い機能を新たに足さず、提示済みの機能の取捨選択に徹してください。さらに各機能を3つの判断軸で見積もってください: initialCost=初期開発コスト（日本円。例: 30〜50万円）、operationCost=運用コスト（継続運用の金額・時間。例: 月3万円+月5時間）、learningCost=顧客の学習コスト（ユーザーが使い方を習得する負担。例: 低/中/高）。includedInMvp で MVPに含むか明示し、絞り込みの理由(rationale)を述べてください。mvpStatement に『このMVPで検証する仮説と提供価値』を1-2文で。",
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
    system:
      "あなたはブランドデザイナーです。事業の世界観・ターゲット・価値から、プロダクトのブランドを設計します。配色は必ずHEXカラーコードで具体的に(primary必須、secondary/accent/neutral/background)。\n" +
      "【配色トーン（重要・厳守）】現代的(モダン)で『薄め・淡い』配色にする。彩度は中〜低め、明度は高めに保ち、コントラストを強くしすぎない。2020年代のモダンSaaSのような、軽く洗練された印象を狙う。\n" +
      "- primary は鮮やかすぎないミュート/ソフトな色みにする（ネオン・原色・濃すぎる色は避ける）。\n" +
      "- accent も派手にせず、primary と調和するくすみ系・パステル寄りにする（ビビッドな原色のアクセントは使わない）。\n" +
      "- background はほぼ白〜ごく淡いティント。neutral は『エレベーテッド・ニュートラル』＝純白や無機質グレーではなく、ウォームサンド/ストーン/トープ/オートミール等の温かみのある淡い中性色を優先する(2026トレンド)。\n" +
      "- accent は『マイクログロー』的な、画面内で一点だけ効かせる明快なポイント色にする(フォーカス/CTA/バッジ想定)。ただし原色・ネオンそのものではなく、淡色基調に馴染む澄んだ色みにとどめる。\n" +
      "- ただし文字が読める最低限のコントラスト(可読性)は確保する。『薄い＝低コントラストで読みにくい』にはしない。\n" +
      "【重要・方向性の分散(2026トレンド準拠)】配色は1案でなく『複数案(paletteOptions)を3つ』提示。いずれも上記の『モダン・淡色』トーンに従いつつ、青一辺倒を避けて方向性を明確に分散させる:\n" +
      "  ① ウォームニュートラル系(サンド/クレイ/トープ) ② くすみパステル系(ラベンダー/ブラッシュ/ミント) ③ 自然由来のセージ/グリーン系。\n" +
      "  事業特性上どうしても青系が最適な場合に限り、3案のうち1案までを淡いブルーグレー系にしてよい(全案を青系にはしない)。それぞれにコンセプト名(name)を付ける。palette には3案のうち最も推奨する案を入れる。\n" +
      "トーン(tone)を形容詞配列で、タイポ方向(typography.heading/body)、ロゴ方向(logoDirection)、イメージ語(imageryKeywords)、ボイス(voice)を日本語で提示。",
    prompt: context,
  });
}
