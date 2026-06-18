/**
 * MVP Builder — データモデル（Drizzle / Neon Postgres）
 *
 * OOUI パイプラインの各工程の成果物を1プロジェクト配下に永続化する。
 * 工程: 資料読込 → アクター整理 → ユースケース → ユースケース図 → OOUI分析
 *      → ジャーニー → ワイヤー → データ設計 → バックエンド要否判定 → プロトタイプ生成
 */
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const projectStatus = pgEnum("project_status", [
  "draft",
  "analyzing",
  "designing",
  "generating",
  "published",
]);

/** 1アイデア = 1プロジェクト */
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: text("owner_id").notNull(), // Better Auth user id
  name: text("name").notNull(),
  summary: text("summary"),
  mvpStatement: text("mvp_statement"), // スコープ確定で生成するMVPの仮説と提供価値
  status: projectStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** 入力資料（PDF / URL / テキスト） */
export const sourceDocuments = pgTable("source_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "pdf" | "url" | "text"
  title: text("title"),
  rawText: text("raw_text"),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** アクター整理 */
export const actors = pgTable("actors", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind"), // "primary" | "secondary" | "system"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** ユースケース書き出し（＋ユースケース図参照） */
export const useCases = pgTable("use_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => actors.id, {
    onDelete: "set null",
  }),
  goal: text("goal").notNull(),
  description: text("description"),
  diagramMermaid: text("diagram_mermaid"), // ユースケース図 (Mermaid)
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** OOUI分析: 抽出オブジェクト（名詞→オブジェクト、動詞→アクション） */
export const oouiObjects = pgTable("ooui_objects", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  attributes: jsonb("attributes").$type<string[]>(),
  actions: jsonb("actions").$type<string[]>(),
  collectionOf: text("collection_of"),
  relations: jsonb("relations").$type<{ to: string; type: string }[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** ナビゲーション設計（メインナビ: トップ階層の画面/メニュー） */
export const navigationItems = pgTable("navigation_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  label: text("label").notNull(), // メニュー表示名（日本語）
  targetObject: text("target_object"), // 対応するOOUIオブジェクト名
  screenType: text("screen_type"), // dashboard | list | detail | form | other
  parent: text("parent"), // 親メニューの label。トップなら null
  icon: text("icon"), // 絵文字など任意
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** ジャーニー整理 */
export const journeys = pgTable("journeys", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  useCaseId: uuid("use_case_id").references(() => useCases.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  steps:
    jsonb("steps").$type<
      { step: string; touchpoint?: string; emotion?: string }[]
    >(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** ワイヤー作成（低忠実度レイアウト） */
export const wireframes = pgTable("wireframes", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  screenName: text("screen_name").notNull(),
  layout: jsonb("layout"), // 構造化レイアウトJSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** データ設計 */
export const dataModelEntities = pgTable("data_model_entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fields: jsonb("fields").$type<{ name: string; type: string }[]>(),
  relations: jsonb("relations").$type<{ to: string; type: string }[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** バックエンド要否判定 */
export const backendSpecs = pgTable("backend_specs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  needsAuth: boolean("needs_auth").default(false),
  needsStorage: boolean("needs_storage").default(false),
  needsDb: boolean("needs_db").default(false),
  externalApis: jsonb("external_apis").$type<string[]>(),
  rationale: text("rationale"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** スコープ確定（機能候補をMVPで作るべき機能に絞り込む） */
export const scopeItems = pgTable("scope_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  impact: integer("impact").notNull(),
  effort: integer("effort").notNull(),
  priority: text("priority").notNull(), // must | should | could | wont
  includedInMvp: boolean("included_in_mvp").notNull().default(false),
  rationale: text("rationale"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** KPI設定（北極星指標 / 補助KPI） */
export const kpiMetrics = pgTable("kpi_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // north_star | supporting
  name: text("name").notNull(),
  definition: text("definition"),
  target: text("target"),
  unit: text("unit"),
  cadence: text("cadence"),
  measurement: text("measurement"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** ブランド設計（1プロジェクト1行） */
export const brandDesign = pgTable("brand_design", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  brandName: text("brand_name"),
  tagline: text("tagline"),
  tone: jsonb("tone").$type<string[]>(),
  palette:
    jsonb("palette").$type<{
      primary: string;
      secondary?: string;
      accent?: string;
      neutral?: string;
      background?: string;
    }>(),
  typography: jsonb("typography").$type<{ heading?: string; body?: string }>(),
  logoDirection: text("logo_direction"),
  imageryKeywords: jsonb("imagery_keywords").$type<string[]>(),
  voice: text("voice"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** モック生成（v0）→ 公開 */
export const prototypes = pgTable("prototypes", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  v0ChatId: text("v0_chat_id"),
  demoUrl: text("demo_url"),
  deploymentUrl: text("deployment_url"),
  githubRepoUrl: text("github_repo_url"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
]);

/** メンバー招待。オープン登録は無効化済みで、招待されたメールのみ登録可能。 */
export const invitations = pgTable("invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  status: invitationStatus("status").notNull().default("pending"),
  invitedBy: text("invited_by").notNull(), // 発行者の user.id
  acceptedUserId: text("accepted_user_id"), // 承諾後に作成された user.id
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
