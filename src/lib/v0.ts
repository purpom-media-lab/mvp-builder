/**
 * v0 Platform API クライアントラッパー
 *
 * 役割: OOUI パイプラインの成果物をプロンプト化して v0 に渡し、
 * クリック可能な Next.js プロトタイプを生成・反復・公開する。
 */
import "./http-timeout";
import { createClient, type ChatDetail } from "v0-sdk";

export const v0 = createClient({ apiKey: process.env.V0_API_KEY });

// ───────────────────────────────────────────────────────────────────────────
// 堅牢化ユーティリティ: リトライ（指数バックオフ）と生成完了ポーリング
//
// v0 SDK はエラーを `Error("HTTP <status>: <body>")` 形式で throw する
// （node_modules/v0-sdk/dist/index.js 参照）。このため message から HTTP
// ステータスを読み取り、一過性障害（ネットワーク / 5xx / 429 / 408）だけを
// リトライ対象にする。認証エラーや不正入力（その他の 4xx）は即座に表面化させる。
// ───────────────────────────────────────────────────────────────────────────

/** リトライ試行回数（初回 + リトライを含む合計） */
const RETRY_ATTEMPTS = 3;
/** バックオフの基準待機時間（ミリ秒）。実際は 2^n で増加させる */
const RETRY_BASE_MS = 500;
/** 生成完了ポーリングの上限時間（ミリ秒） */
const POLL_TIMEOUT_MS = 120_000;
/** 生成完了ポーリングの間隔（ミリ秒） */
const POLL_INTERVAL_MS = 3_000;

/** 指定ミリ秒だけ待機する */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SDK のエラーメッセージ（"HTTP 503: ..."）から HTTP ステータスを抽出する。
 *  ステータスを特定できない場合（ネットワーク断やタイムアウト等）は null。 */
function parseHttpStatus(err: unknown): number | null {
  const message = err instanceof Error ? err.message : String(err);
  const match = /HTTP (\d{3})/.exec(message);
  return match ? Number(match[1]) : null;
}

/** リトライすべき一過性障害かどうかを判定する。
 *  - 5xx / 429（レート制限）/ 408（タイムアウト）はリトライ
 *  - その他の 4xx（401/403 認証・400/422 不正入力など）はリトライしない
 *  - ステータス不明（ネットワーク断・タイムアウト）はリトライ */
function isRetryableError(err: unknown): boolean {
  const status = parseHttpStatus(err);
  if (status === null) return true;
  if (status >= 500) return true;
  return status === 429 || status === 408;
}

/** 一過性障害に対して指数バックオフ（+ジッター）でリトライするラッパー。
 *  クライアントエラー（リトライ不可）は即座に再 throw する。 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === RETRY_ATTEMPTS - 1;
      if (isLast || !isRetryableError(err)) throw err;
      // 指数バックオフ: base * 2^attempt にジッター（0〜base）を加える
      const backoff =
        RETRY_BASE_MS * 2 ** attempt + Math.floor(Math.random() * RETRY_BASE_MS);
      console.warn(
        `[v0] ${label} failed (attempt ${attempt + 1}/${RETRY_ATTEMPTS}), retrying in ${backoff}ms:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(backoff);
    }
  }
  // ループは return か throw で抜けるため通常到達しないが、型のために残す
  throw lastError;
}

/** latestVersion の status が "pending" のとき、生成完了まで getById でポーリングする。
 *  完了（"completed"）した ChatDetail を返す。"failed" や上限超過時は例外を投げる。
 *
 *  responseMode 既定の "sync" では create が完了まで応答を保持するため通常は不要だが、
 *  万一 "pending" のまま返ってきた場合の保険として完了を待つ。getById は生成直後に
 *  一時的な 404 を返すことがあるため、その間はリトライ扱いで待ち続ける。 */
async function waitForCompletion(chatId: string): Promise<ChatDetail> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let chat: ChatDetail;
    try {
      chat = await withRetry(
        () => v0.chats.getById({ chatId }),
        `chats.getById(${chatId})`,
      );
    } catch (err) {
      // 生成直後の一時的な 404 は完了待ちとして許容し、ポーリングを継続する
      if (parseHttpStatus(err) === 404) continue;
      throw err;
    }
    const status = chat.latestVersion?.status;
    if (status === "completed") return chat;
    if (status === "failed") {
      throw new Error(`v0 generation failed for chat ${chatId}`);
    }
    // status === "pending"（または未確定）なら次のインターバルまで待つ
  }
  throw new Error(
    `v0 generation did not complete within ${POLL_TIMEOUT_MS}ms for chat ${chatId}`,
  );
}

export interface PrototypeContext {
  projectName: string;
  summary?: string | null;
  actors: { name: string; description?: string | null }[];
  useCases: { goal: string; description?: string | null }[];
  oouiObjects: { name: string; attributes?: string[] | null }[];
  navigation?: {
    label: string;
    targetObject?: string | null;
    screenType?: string | null;
    parent?: string | null;
    icon?: string | null;
  }[];
  /**
   * 生成対象の画面名（ナビのラベル）。指定があれば「これらの画面だけを過不足なく実装」する。
   * 出力量を抑えて途中切れを防ぎ、作りたい画面に集中させるための分割生成に使う。
   * 未指定（全画面）なら従来どおり navigation 全体を作る。
   */
  selectedScreens?: string[];
  /** このMVPで検証する仮説・提供価値（スコープ確定の宣言） */
  mvpStatement?: string | null;
  /** MVPに含む機能（これらだけを実装する。スコープ確定済みの includedInMvp 機能） */
  scope?: { name: string; description?: string | null }[];
  /** ダッシュボードに表示する主要KPI */
  kpis?: { name: string; target?: string | null }[];
  /** ブランド設計（生成UIの世界観に反映する） */
  brand?: {
    brandName?: string | null;
    tagline?: string | null;
    tone?: string[] | null;
    palette?: {
      primary: string;
      secondary?: string;
      accent?: string;
      neutral?: string;
      background?: string;
    } | null;
    typography?: { heading?: string; body?: string } | null;
    logoDirection?: string | null;
  } | null;
  requirement?: string;
  /**
   * デザイナー連携: リファインの参照デザイン。
   * v1 は「参照ベースの再生成」（Figma URL / PDF を見て UI を洗練する指示を注入）。
   * TODO: Figma→コードの完全自動化や Figma MCP 連携は将来対応（現状スコープ外）。
   */
  refineReference?: {
    type: "figma" | "pdf";
    url?: string;
    note?: string;
  };
}

/** パイプライン成果物 → v0 への生成プロンプトを組み立てる */
export function buildPrototypePrompt(ctx: PrototypeContext): string {
  const lines: string[] = [
    `次のアプリの「クリック可能なUIプロトタイプ」を Next.js で作ってください。モックデータで画面遷移できること。`,
    ``,
    `## アプリ概要`,
    `- ${ctx.projectName}${ctx.summary ? `：${ctx.summary}` : ""}`,
    ``,
    `## アクター`,
    ...ctx.actors.map(
      (a) => `- ${a.name}${a.description ? `：${a.description}` : ""}`,
    ),
    ``,
    `## 主要ユースケース`,
    ...ctx.useCases.map(
      (u, i) =>
        `${i + 1}. ${u.goal}${u.description ? `（${u.description}）` : ""}`,
    ),
    ``,
    `## 主要オブジェクト（画面/データの単位）`,
    ...ctx.oouiObjects.map(
      (o) =>
        `- ${o.name}${o.attributes?.length ? `（${o.attributes.join(", ")}）` : ""}`,
    ),
  ];
  if (ctx.navigation?.length) {
    lines.push(
      "",
      "## メインナビゲーション（この構成・順序でサイドバー/トップメニューを作ること）",
      ...ctx.navigation
        .filter((n) => !n.parent)
        .map((top) => {
          const children = (ctx.navigation ?? []).filter(
            (c) => c.parent === top.label,
          );
          const head = `- ${top.icon ? `${top.icon} ` : ""}${top.label}${top.screenType ? `（${top.screenType}）` : ""}`;
          const sub = children.map(
            (c) => `\n  - ${c.icon ? `${c.icon} ` : ""}${c.label}`,
          );
          return head + sub.join("");
        }),
    );
  }
  if (ctx.selectedScreens?.length) {
    lines.push(
      "",
      "## 生成対象の画面（重要・厳守）",
      "次に列挙する画面だけを、過不足なく **すべて** 実装すること。途中で省略・打ち切りをしない。",
      "列挙されていない画面は作らない。各画面はクリックで実際に行き来できること。",
      ...ctx.selectedScreens.map((s) => `- ${s}`),
    );
  }
  if (ctx.mvpStatement) {
    lines.push("", "## このMVPで検証する仮説・提供価値", ctx.mvpStatement);
  }
  if (ctx.scope?.length) {
    lines.push(
      "",
      "## MVPに含む機能（これらだけを実装すること。スコープ外の機能は作らない）",
      ...ctx.scope.map(
        (f) => `- ${f.name}${f.description ? `：${f.description}` : ""}`,
      ),
    );
  }
  if (ctx.kpis?.length) {
    lines.push(
      "",
      "## ダッシュボードに表示する主要KPI（実データ風のモック値で）",
      ...ctx.kpis.map(
        (k) => `- ${k.name}${k.target ? `（目標: ${k.target}）` : ""}`,
      ),
    );
  }
  if (ctx.brand) {
    const b = ctx.brand;
    const brandLines: string[] = [
      "",
      "## ブランド（このブランドの世界観・配色でUIをデザインすること）",
    ];
    if (b.brandName) brandLines.push(`- ブランド名: ${b.brandName}`);
    if (b.tagline) brandLines.push(`- タグライン: ${b.tagline}`);
    if (b.tone?.length) brandLines.push(`- トーン: ${b.tone.join(" / ")}`);
    if (b.palette) {
      const p = b.palette;
      const swatches = [
        `Primary=${p.primary}`,
        p.secondary && `Secondary=${p.secondary}`,
        p.accent && `Accent=${p.accent}`,
        p.neutral && `Neutral=${p.neutral}`,
        p.background && `Background=${p.background}`,
      ].filter(Boolean);
      brandLines.push(
        `- 配色（このHEXを基調に。Primaryをブランドカラーとしてボタン/アクセントに使う）: ${swatches.join(", ")}`,
      );
    }
    if (b.typography?.heading || b.typography?.body) {
      brandLines.push(
        `- タイポ: 見出し=${b.typography.heading ?? "—"} / 本文=${b.typography.body ?? "—"}`,
      );
    }
    if (b.logoDirection) brandLines.push(`- ロゴ方向: ${b.logoDirection}`);
    lines.push(...brandLines);
  }
  if (ctx.refineReference) {
    const r = ctx.refineReference;
    const refLines: string[] = [
      "",
      "## デザイナーによるリファイン（最優先で反映すること）",
      r.type === "figma"
        ? `- デザイナーが Figma でUIを作り込みました。次の Figma を参照デザインとして、レイアウト・余白・配色・コンポーネントの質感をこのデザインに寄せてUIを洗練してください: ${r.url ?? "(URL未指定)"}`
        : `- デザイナーが PDF でデザイン案を作成しました。その PDF のビジュアル（レイアウト・余白・配色・コンポーネントの質感）に寄せてUIを洗練してください${r.url ? `（参照: ${r.url}）` : "（PDFは別途共有）"}。`,
      "- 機能・画面構成・モックデータの内容は維持しつつ、見た目の完成度（タイポグラフィ・間隔・階層・余白・配色の一貫性）をプロ品質に引き上げること。",
    ];
    if (r.note) refLines.push(`- デザイナー/依頼者からの補足: ${r.note}`);
    lines.push(...refLines);
  }
  if (ctx.requirement) {
    lines.push("", "## 追加の要望", ctx.requirement);
  }
  return lines.join("\n");
}

/** プロトタイプを生成し、demoUrl を返す
 *
 * responseMode は既定の "sync"。生成完了まで HTTP 応答を保持するため、重い仕様で
 * 生成が長引いても demoUrl を確実に受け取れる（async + getById ポーリングは
 * 生成直後の chat が長時間 404 になり不安定だった）。長時間リクエストが undici の
 * 既定 300 秒タイムアウトで切れないよう ./http-timeout で無効化済み。
 */
export async function createPrototype(ctx: PrototypeContext) {
  // 生成リクエストは一過性障害に備えてリトライでラップする
  const chat = await withRetry(
    () => v0.chats.create({ message: buildPrototypePrompt(ctx) }),
    "chats.create",
  );
  // 非ストリーミング応答（ChatDetail）に絞り込む
  if (!("id" in chat)) {
    throw new Error(
      "v0.chats.create returned an unexpected streaming response",
    );
  }
  // sync モードでは通常ここで完了しているが、万一 "pending" のまま返った場合は
  // 完了までポーリングしてから demoUrl を確定させる（"failed"・上限超過時は例外）。
  const resolved: ChatDetail =
    chat.latestVersion?.status === "pending"
      ? await waitForCompletion(chat.id)
      : chat;
  return {
    chatId: resolved.id,
    demoUrl: resolved.latestVersion?.demoUrl ?? null,
    webUrl: resolved.webUrl ?? null,
  };
}
