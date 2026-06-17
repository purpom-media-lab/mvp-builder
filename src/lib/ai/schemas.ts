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

export const oouiSchema = z.object({
  objects: z.array(
    z.object({
      name: z.string().describe("オブジェクト名（名詞・日本語）"),
      attributes: z.array(z.string()).describe("属性（英語の識別子）"),
      actions: z.array(z.string()).describe("アクション（動詞・英語の識別子）"),
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

export type ActorsOutput = z.infer<typeof actorsSchema>;
export type UseCasesOutput = z.infer<typeof useCasesSchema>;
export type OouiOutput = z.infer<typeof oouiSchema>;
export type JourneyOutput = z.infer<typeof journeySchema>;
export type DataModelOutput = z.infer<typeof dataModelSchema>;
export type NavigationOutput = z.infer<typeof navigationSchema>;
export type WireframeOutput = z.infer<typeof wireframeSchema>;
export type BackendSpecOutput = z.infer<typeof backendSpecSchema>;
export type OrchestratePlan = z.infer<typeof orchestratePlanSchema>;
