/**
 * LEAN QUEST AI — データモデル（Drizzle / Neon Postgres）
 *
 * OOUI パイプラインの各工程の成果物を1プロジェクト配下に永続化する。
 * 工程: 資料読込 → アクター整理 → ユースケース → ユースケース図 → OOUI分析
 *      → ジャーニー → ワイヤー → データ設計 → バックエンド要否判定 → プロトタイプ生成
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
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
  // ユーザーが入力する「詳細（入力資料/intake）」。手入力のアイデア・要件テキスト。
  // 旧: source_documents(type=text) に保存していたが projects 直下へ移設。
  detail: text("detail"),
  // ジョブ理論(JTBD)など背景処理が生成する「分析結果」（構造化要望テキスト）。
  // detail（ユーザー入力）とは別管理にし、分析が手入力を上書きしないようにする。
  analysisResult: text("analysis_result"),
  mvpStatement: text("mvp_statement"), // スコープ確定で生成するMVPの仮説と提供価値
  // market 工程で生成する市場・競合分析（marketSchema 互換）。
  // 1プロジェクト1件のため、独立テーブルにせず projects 直下に jsonb で持つ（growthPlan と同方針）。
  marketAnalysis: jsonb("market_analysis").$type<{
    marketSize: { tam: string; sam: string; som: string; assumptions: string };
    trends: string[];
    positioning: { xAxis: string; yAxis: string };
    competitors: {
      name: string;
      type: "direct" | "indirect" | "alternative";
      description?: string | null;
      strengths: string;
      weaknesses: string;
      x: number;
      y: number;
    }[];
    whitespace: string;
    differentiation: string;
  }>(),
  // KPI工程で生成するグロース計画（model/levers/experiments/milestones）
  growthPlan: jsonb("growth_plan").$type<{
    model: string;
    levers: string[];
    experiments: {
      title: string;
      hypothesis?: string;
      metric?: string;
      effort?: string;
    }[];
    milestones?: { period: string; target: string }[];
  }>(),
  // 提案資料の slideData（figma-slide-gen 互換のスライド配列）
  deck: jsonb("deck").$type<unknown[]>(),
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
  // 英名 name + 日本語名 label を併記（旧データは string[] のことがある）
  attributes: jsonb("attributes").$type<{ name: string; label?: string }[]>(),
  actions: jsonb("actions").$type<{ name: string; label?: string }[]>(),
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
      {
        phase?: string;
        action: string;
        touchpoint?: string;
        emotion?: string;
        painpoint?: string;
        opportunity?: string;
      }[]
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
  // 判断軸: 初期開発 / 運用 / 顧客の学習コスト
  initialCost: text("initial_cost"),
  operationCost: text("operation_cost"),
  learningCost: text("learning_cost"),
  validationCost: text("validation_cost"), // 旧: 検証コスト（後方互換のため残置・未使用）
  operationTime: text("operation_time"), // 旧: 実運用時間（後方互換のため残置・未使用）
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
  // 配色の複数案（AIが提示する 3 案。UI で選択して palette に反映する）
  paletteOptions:
    jsonb("palette_options").$type<
      {
        name: string;
        primary: string;
        secondary?: string;
        accent?: string;
        neutral?: string;
        background?: string;
      }[]
    >(),
  typography: jsonb("typography").$type<{ heading?: string; body?: string }>(),
  logoDirection: text("logo_direction"),
  imageryKeywords: jsonb("imagery_keywords").$type<string[]>(),
  voice: text("voice"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

/** チャット会話履歴（プロジェクト×スコープ ごとに1スレッド） */
export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(), // 'analysis' | 'jtbd'
  messages: jsonb("messages").$type<unknown[]>(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * 実ユーザー（回答者）の声。公開プロト(/run)に埋め込んだウィジェットから、
 * 匿名の回答者ごとに JTBD インタビューの全文と構造化サマリを蓄積する。
 * ビルダー側の chat_messages（builder本人用）とは別物。
 */
export const userVoices = pgTable("user_voices", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // 匿名の回答者識別子（localStorage 生成）。同一回答者の追記に使う。
  respondentId: text("respondent_id").notNull(),
  // インタビュー全文 [{ role: 'user' | 'assistant', content: string }]
  messages: jsonb("messages").$type<{ role: string; content: string }[]>(),
  // 会話末に抽出する構造化サマリ（状況/ジョブ/代替/障壁/成功基準 等）
  jobSummary: jsonb("job_summary").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("in_progress"), // in_progress | completed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/** モック生成（v0）→ 公開 */
export const prototypes = pgTable("prototypes", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  v0ChatId: text("v0_chat_id"),
  demoUrl: text("demo_url"),
  /** AWS エンジンで生成した自己完結 HTML プレビュー（保存・再読込用） */
  html: text("html"),
  /**
   * DSエンジンの画面別ソース（部分再生成の非破壊マージ用）。
   * 選択画面だけを作り直し、残りはこの保存ソースを再利用して全画面のHTMLを再構築する。
   */
  dsScreens: jsonb("ds_screens").$type<
    {
      label: string;
      componentName: string;
      source: string;
      failed: boolean;
      parent?: string | null;
    }[]
  >(),
  /**
   * DSエンジンの daisyUI テーマ（AI生成）。部分再生成では作り直さず再利用して
   * 配色の一貫性を保ち、テーマ生成のLLM呼び出し（数十秒）を省く。
   */
  dsTheme: jsonb("ds_theme").$type<
    import("@/lib/prototype-ds/shell").DaisyTheme
  >(),
  deploymentUrl: text("deployment_url"),
  githubRepoUrl: text("github_repo_url"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * デザイナー連携（リファイン依頼）。
 * プロトタイプ完成後、デザイナーに渡すデザインブリーフ（依頼項目）を保存し、
 * デザイナーが作った成果物（Figma URL / PDF）を参照してプロトタイプを
 * ブラッシュアップ（再生成）するための情報を 1 プロジェクト 1 行で持つ。
 */
export const designRequests = pgTable("design_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // 依頼項目（デザインブリーフ）。designBriefSchema の構造化出力をそのまま保存
  brief: jsonb("brief").$type<{
    productName: string;
    overview: string;
    objective: string;
    targetUsers: string;
    scopeScreens: string;
    brand: string;
    references: string;
    constraints: string;
    emphasis: string;
    deliverable: "figma" | "pdf";
    deadline: string;
  }>(),
  status: text("status").notNull().default("draft"), // draft | requested | received
  figmaUrl: text("figma_url"), // デザイナー成果物（Figma URL）
  pdfName: text("pdf_name"), // デザイナー成果物（PDF ファイル名）
  pdfData: text("pdf_data"), // PDF を base64 で保持（任意）
  refinedNote: text("refined_note"), // リファイン時の補足メモ
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * エンジニア連携（開発依頼）。
 * プロトタイプ完成後、エンジニアに渡す開発依頼（開発仕様書/チケット）を保存する。
 * プロジェクトの分析・設計結果から MVP を実装に落とすための依頼項目を
 * 1 プロジェクト 1 行で持つ。
 */
export const engineerRequests = pgTable("engineer_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // 依頼項目（エンジニアブリーフ）。engineerBriefSchema の構造化出力をそのまま保存
  brief: jsonb("brief").$type<{
    productName: string;
    overview: string;
    functionalRequirements: string;
    screens: string;
    dataModel: string;
    apiEndpoints: string;
    nonFunctional: string;
    suggestedStack: string;
    milestones: string;
    acceptanceCriteria: string;
    deliverable: "repo" | "spec";
    deadline: string;
  }>(),
  deliverable: text("deliverable").notNull().default("repo"), // repo | spec
  deadline: text("deadline"),
  status: text("status").notNull().default("draft"), // draft | requested
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

/**
 * 共有マルチテナントの「本実装」データストア。
 * 各プロジェクト(=公開MVP)のフォーム等のデータをここに保存する。
 * ownerKey は匿名ブラウザID（Phase2 でエンドユーザIDに拡張予定）。
 */
export const mvpRecords = pgTable(
  "mvp_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    ownerKey: text("owner_key"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("mvp_records_project_collection_idx").on(t.projectId, t.collection),
  ],
);

/**
 * 公開MVPのエンドユーザー（Phase2）。
 * ビルダー利用者(better-auth の users)とは別の、各公開MVPにサインアップする
 * エンドユーザーを projectId スコープで保持する。
 * 同一プロジェクト内で email はユニーク（プロジェクトをまたげば同一 email 可）。
 * passwordHash は scrypt(salt 付き) のハッシュ文字列。
 */
export const mvpEndUsers = pgTable(
  "mvp_end_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("mvp_end_users_project_email_idx").on(t.projectId, t.email),
  ],
);

/** ジョブ種別: 単一工程 / 一括生成 / プロトタイプ生成 / 提案資料 / デザイナー依頼ブリーフ / エンジニア依頼ブリーフ / デザイナー成果物リファイン */
export const jobKind = pgEnum("job_kind", [
  "step",
  "orchestrate",
  "prototype",
  "deck",
  "design-brief",
  "engineer-brief",
  "design-refine",
]);
/** ジョブ状態 */
export const jobStatus = pgEnum("job_status", ["running", "done", "error"]);

/**
 * 非同期生成ジョブ。
 *
 * 生成を HTTP レスポンスのライフサイクルから切り離すための状態テーブル。
 * クライアントは POST /api/jobs で起動して jobId を即受け取り、画面を遷移・リロード
 * しても GET /api/jobs/[id] のポーリングで進捗・結果を購読できる。実処理は after() で
 * レスポンス後も継続し、完了時にドメインテーブルへ保存しつつこの行も更新する。
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(), // Better Auth user id（起動者）
    kind: jobKind("kind").notNull(),
    // kind=step のときの工程キー（StepKey）。kind=prototype のときは mode（create/update/realize）。
    step: text("step"),
    status: jobStatus("status").notNull().default("running"),
    // 進捗。kind 依存の自由構造（例: { doneSteps, totalSteps } / { chars } / { label }）。
    progress: jsonb("progress")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // 完了時の結果。クライアントがローカル状態へ適用するためのもの（ドメインテーブルにも保存済み）。
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    // 再実行や stale 判定に必要な入力一式（context/provider/modelId など）。
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // 進行中の生存確認。一定時間更新が無い running はクラッシュとみなし error 化する。
    heartbeatAt: timestamp("heartbeat_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
  },
  (t) => [index("jobs_project_status_idx").on(t.projectId, t.status)],
);

/**
 * Vercel OAuth 連携（ビルダー利用者ごとに1行）。
 *
 * 各ビルダー利用者が自分の Vercel アカウント/チームを連携し、生成した MVP を
 * 「自分の Vercel」に公開できるようにするための per-user トークン保管。
 * access_token は平文で保存せず AES-256-GCM で暗号化して持つ（src/lib/crypto.ts）。
 */
export const vercelConnections = pgTable("vercel_connections", {
  // Better Auth user.id（1ユーザー1連携なので PK 兼）
  ownerId: text("owner_id").primaryKey(),
  // AES-256-GCM 暗号化済みアクセストークン（iv:tag:cipher の base64）
  accessTokenEnc: text("access_token_enc").notNull(),
  // 連携先チーム（null=personal アカウント）
  teamId: text("team_id"),
  // インストール識別子（configurationId）。連携解除や再連携の突合に使う。
  installationId: text("installation_id"),
  // 表示用の Vercel ユーザー識別（ハンドル/ID など。任意）
  vercelUser: text("vercel_user"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
