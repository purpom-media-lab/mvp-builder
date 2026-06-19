/** OOUI パイプライン各工程の構造化出力スキーマ（Zod） */
import { z } from "zod";

export const actorsSchema = z.object({
  actors: z.array(
    z.object({
      name: z.string().describe("アクター名"),
      description: z.string().describe("役割・特徴"),
      kind: z.enum(["primary", "secondary", "system"]).describe("種別"),
    }),
  ),
});

export const useCasesSchema = z.object({
  useCases: z.array(
    z.object({
      actorName: z.string().describe("対応するアクター名"),
      goal: z.string().describe("ユースケースの目的（〜する）"),
      description: z.string().describe("概要"),
    }),
  ),
});

/** プロパティ/アクション項目（英名＋日本語名を併記） */
const oouiTerm = z.object({
  name: z.string().describe("英語の識別子（例: leadScore）"),
  label: z.string().describe("日本語の表示名（例: 確度スコア）"),
});
export const oouiSchema = z.object({
  objects: z.array(
    z.object({
      name: z.string().describe("オブジェクト名（名詞・日本語）"),
      attributes: z
        .array(oouiTerm)
        .describe("属性（英名 name と 日本語名 label を両方）"),
      actions: z
        .array(oouiTerm)
        .describe("アクション（動詞。英名 name と 日本語名 label を両方）"),
      collectionOf: z
        .string()
        .nullable()
        .describe("コレクションの場合の要素名（日本語のオブジェクト名）"),
      relations: z
        .array(
          z.object({
            to: z.string().describe("関係先のオブジェクト名（日本語）"),
            type: z.string().describe("関係の種別（日本語。例: 保有する）"),
          }),
        )
        .describe("他オブジェクトとの関係"),
    }),
  ),
});

/** ジャーニー整理（アクター/ユースケースから主要なユーザージャーニー） */
export const journeySchema = z.object({
  journeys: z.array(
    z.object({
      name: z.string().describe("ジャーニー名（日本語）"),
      steps: z
        .array(
          z.object({
            step: z.string().describe("行動（ユーザーの行動・日本語）"),
            touchpoint: z
              .string()
              .nullable()
              .describe("接点（画面・チャネルなど・日本語）"),
            emotion: z
              .string()
              .nullable()
              .describe("感情（その時の気持ち・日本語）"),
          }),
        )
        .describe("ジャーニーを構成するステップ（時系列順）"),
    }),
  ),
});

/** データ設計（永続化に必要なデータエンティティ） */
export const dataModelSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().describe("エンティティ名（日本語可）"),
      fields: z
        .array(
          z.object({
            name: z.string().describe("フィールド名（英語の識別子）"),
            type: z.string().describe("データ型"),
          }),
        )
        .describe("エンティティの属性"),
      relations: z
        .array(
          z.object({
            to: z.string().describe("関連先エンティティ名"),
            type: z.string().describe("関係種別（日本語）"),
          }),
        )
        .describe("他エンティティとの関係"),
    }),
  ),
});

/** ナビゲーション設計（メインナビ: トップ階層の画面/メニュー） */
export const navigationSchema = z.object({
  items: z.array(
    z.object({
      label: z.string().describe("メニュー表示名（日本語）"),
      targetObject: z
        .string()
        .describe("対応するOOUIオブジェクト名（日本語。該当なければ空文字）"),
      screenType: z
        .enum(["dashboard", "list", "detail", "form", "other"])
        .describe("画面種別。コレクション=list, 単一=detail, 集約=dashboard 等"),
      parent: z
        .string()
        .nullable()
        .describe("親メニューの label。トップ階層なら null"),
      icon: z.string().nullable().describe("絵文字など任意のアイコン"),
    }),
  ),
});

/** ワイヤーフレーム（画面ごとの低忠実度レイアウト＝セクション構成） */
export const wireframeSchema = z.object({
  screens: z.array(
    z.object({
      screenName: z
        .string()
        .describe("画面名（日本語。ナビのメニュー名に対応）"),
      screenType: z
        .string()
        .nullable()
        .describe("画面種別（dashboard/list/detail/form など）"),
      sections: z
        .array(
          z.object({
            type: z
              .enum([
                "header",
                "toolbar",
                "kpi",
                "chart",
                "table",
                "list",
                "cards",
                "form",
                "detail",
                "sidebar",
                "footer",
                "other",
              ])
              .describe("セクション種別"),
            label: z.string().describe("セクションの見出し/説明（日本語）"),
            items: z
              .array(z.string())
              .nullable()
              .describe("主要要素（カラム名/ボタン/項目など・日本語）"),
          }),
        )
        .describe("画面を構成するセクション（上から順）"),
    }),
  ),
});

export const backendSpecSchema = z.object({
  needsAuth: z.boolean(),
  needsStorage: z.boolean(),
  needsDb: z.boolean(),
  externalApis: z.array(z.string()),
  rationale: z.string().describe("判定理由"),
});

/** スコープ確定（機能候補を洗い出し、MVPで作るべき機能を10個以下に絞り込む） */
export const scopeSchema = z.object({
  mvpStatement: z
    .string()
    .describe("このMVPで検証する仮説と提供価値（1-2文）"),
  features: z.array(
    z.object({
      name: z.string().describe("機能名"),
      description: z.string().optional().describe("機能の概要"),
      impact: z.number().int().min(1).max(5).describe("影響度（1-5）"),
      effort: z.number().int().min(1).max(5).describe("実装工数（1-5）"),
      initialCost: z
        .string()
        .describe("初期開発コスト（構築の参考金額。例: 30〜50万円）"),
      operationCost: z
        .string()
        .describe("運用コスト（継続運用の参考金額・時間。例: 月3万円 + 月5時間）"),
      learningCost: z
        .string()
        .describe(
          "顧客の学習コスト（ユーザーが使い方を習得する負担。例: 低/中/高・習得目安）",
        ),
      priority: z
        .enum(["must", "should", "could", "wont"])
        .describe("優先度（MoSCoW）"),
      includedInMvp: z.boolean().describe("MVPに含むか"),
      rationale: z.string().optional().describe("絞り込みの理由"),
    }),
  ),
});

/** KPI設定（北極星指標と補助KPI） */
const kpiMetric = z.object({
  name: z.string().describe("指標名"),
  definition: z.string().optional().describe("定義"),
  target: z.string().optional().describe("目標値"),
  unit: z.string().optional().describe("単位"),
  cadence: z.string().optional().describe("計測頻度"),
  measurement: z.string().optional().describe("計測方法"),
});
/** グロース計画（KPI を伸ばすための計画。独立工程） */
export const growthSchema = z.object({
  model: z
    .string()
    .describe("グロースモデル/ループの説明（どうやって成長を生むか）"),
  levers: z.array(z.string()).describe("主要なグロースレバー（成長の打ち手の軸）"),
  experiments: z
    .array(
      z.object({
        title: z.string().describe("施策・実験のタイトル"),
        hypothesis: z.string().optional().describe("仮説"),
        metric: z.string().optional().describe("動かす指標"),
        effort: z.string().optional().describe("工数/難易度（例: 低/中/高）"),
      }),
    )
    .describe("優先度順の施策/実験（3〜5個）"),
  milestones: z
    .array(
      z.object({
        period: z.string().describe("時期（例: 1ヶ月後 / Q1）"),
        target: z.string().describe("その時点の目標"),
      }),
    )
    .optional()
    .describe("時期ごとの目標マイルストーン"),
});
export const kpiSchema = z.object({
  northStar: kpiMetric.describe("北極星指標（1つ）"),
  supporting: z.array(kpiMetric).describe("補助KPI（3〜5個）"),
});

/** 配色（すべて HEX カラーコード） */
const paletteShape = z.object({
  primary: z.string().describe("主要色（HEX）"),
  secondary: z.string().optional().describe("副色（HEX）"),
  accent: z.string().optional().describe("アクセント色（HEX）"),
  neutral: z.string().optional().describe("ニュートラル色（HEX）"),
  background: z.string().optional().describe("背景色（HEX）"),
});

/** ブランド設計（配色はHEXカラーコード前提） */
export const brandSchema = z.object({
  brandName: z.string().optional().describe("ブランド名"),
  tagline: z.string().optional().describe("タグライン"),
  tone: z.array(z.string()).describe("トーン（形容詞配列）"),
  // 配色は複数案を提示し、palette は推奨（既定）案を入れる
  palette: paletteShape.describe("推奨する配色（paletteOptions のうち最も推奨する案）"),
  paletteOptions: z
    .array(
      paletteShape.extend({
        name: z.string().describe("配色コンセプト名（例: 信頼のネイビー）"),
      }),
    )
    .min(2)
    .describe("配色の複数案（3案。それぞれ異なる方向性・コンセプト名つき）"),
  typography: z
    .object({
      heading: z.string().optional().describe("見出しフォント方向"),
      body: z.string().optional().describe("本文フォント方向"),
    })
    .optional(),
  logoDirection: z.string().optional().describe("ロゴ方向"),
  imageryKeywords: z.array(z.string()).optional().describe("イメージ語"),
  voice: z.string().optional().describe("ボイス"),
});

/** チャット要望から「どの工程を再実行し、プロトタイプを作り直すか」を決める計画 */
export const orchestratePlanSchema = z.object({
  steps: z
    .array(
      z.enum([
        "actors",
        "usecases",
        "ooui",
        "journey",
        "navigation",
        "wireframe",
        "datamodel",
        "backend",
        "scope",
        "kpi",
        "growth",
        "brand",
      ]),
    )
    .describe(
      "ユーザー要望を満たすために再実行すべき分析工程（依存順。最小限に。不要なら空配列）",
    ),
  regeneratePrototype: z
    .boolean()
    .describe("分析更新後にプロトタイプ(UI)を作り直すべきか"),
  reply: z
    .string()
    .describe("ユーザーへの短い日本語の返答（何をするか・何が変わるか）"),
});

/** デザイナー連携: リファイン依頼の「依頼項目（デザインブリーフ）」 */
export const designBriefSchema = z.object({
  productName: z.string().describe("プロダクト名"),
  overview: z.string().describe("プロダクトの概要（1-2文）"),
  objective: z
    .string()
    .describe("リファインの目的（このリファインで何を良くしたいか）"),
  targetUsers: z
    .string()
    .describe("ターゲット/ペルソナ（主要アクターから。改行区切り可）"),
  scopeScreens: z
    .string()
    .describe("対象画面・スコープ（ナビ/ワイヤーから対象とする画面。改行区切り可）"),
  brand: z
    .string()
    .describe("ブランド指定（配色HEX・トーンマナー・ロゴ方向。brand設計から）"),
  references: z
    .string()
    .describe("参考デザイン・トンマナ参照（URLや説明。改行区切り可）"),
  constraints: z
    .string()
    .describe("制約（アクセシビリティ/ブランドガイド/技術など。改行区切り可）"),
  emphasis: z.string().describe("重視点・改善要望（特に良くしてほしい点）"),
  deliverable: z
    .enum(["figma", "pdf"])
    .describe("希望する成果物形式（figma=Figmaデータ / pdf=PDF）"),
  deadline: z.string().describe("納期（例: 2週間後 / 未定）"),
});

/** エンジニア連携: 開発依頼（開発仕様書/チケット）の「依頼項目（エンジニアブリーフ）」 */
export const engineerBriefSchema = z.object({
  productName: z.string().describe("プロダクト名"),
  overview: z
    .string()
    .describe("背景・目的（なぜ作るのか、何を解決するのか。1-3文）"),
  functionalRequirements: z
    .string()
    .describe(
      "機能要件（MVPで実装する機能の一覧と概要。箇条書き・改行区切りで具体的に）",
    ),
  screens: z
    .string()
    .describe("主要画面（画面名と役割。ナビ/ワイヤーから。改行区切り可）"),
  dataModel: z
    .string()
    .describe(
      "データ設計（主要エンティティと関係。データ設計工程から。改行区切り可）",
    ),
  apiEndpoints: z
    .string()
    .describe(
      "主要API（想定するエンドポイント。例: POST /leads など。改行区切り可）",
    ),
  nonFunctional: z
    .string()
    .describe("非機能要件（認証/権限/性能/セキュリティなど。改行区切り可）"),
  suggestedStack: z
    .string()
    .describe("推奨技術スタック（フロント/バック/DB/インフラなど）"),
  milestones: z
    .string()
    .describe("マイルストーン/フェーズ（開発の段階と目安。改行区切り可）"),
  acceptanceCriteria: z
    .string()
    .describe("受け入れ条件（完成と判断する条件。改行区切り可）"),
  deliverable: z
    .enum(["repo", "spec"])
    .describe(
      "希望する成果物形式（repo=動くコード/リポジトリ / spec=開発仕様書）",
    ),
  deadline: z.string().describe("納期（例: 1ヶ月後 / 未定）"),
});

export type ActorsOutput = z.infer<typeof actorsSchema>;
export type UseCasesOutput = z.infer<typeof useCasesSchema>;
export type OouiOutput = z.infer<typeof oouiSchema>;
export type JourneyOutput = z.infer<typeof journeySchema>;
export type DataModelOutput = z.infer<typeof dataModelSchema>;
export type NavigationOutput = z.infer<typeof navigationSchema>;
export type WireframeOutput = z.infer<typeof wireframeSchema>;
export type BackendSpecOutput = z.infer<typeof backendSpecSchema>;
export type ScopeOutput = z.infer<typeof scopeSchema>;
export type KpiOutput = z.infer<typeof kpiSchema>;
export type GrowthOutput = z.infer<typeof growthSchema>;
export type BrandOutput = z.infer<typeof brandSchema>;
export type OrchestratePlan = z.infer<typeof orchestratePlanSchema>;
export type DesignBriefOutput = z.infer<typeof designBriefSchema>;
export type EngineerBriefOutput = z.infer<typeof engineerBriefSchema>;
