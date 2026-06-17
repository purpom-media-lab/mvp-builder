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
  requirement?: string;
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
