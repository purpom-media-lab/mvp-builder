/**
 * Vercel OAuth 連携（ユーザー所有アカウントへの公開）— サーバ専用。
 *
 * 各ビルダー利用者が自分の Vercel を OAuth で連携し、生成 MVP を「自分の Vercel」に
 * 公開できるようにする。本モジュールは設定判定・インストールURL生成・CSRF state の
 * 署名/検証・code→token 交換・per-user トークンの暗号化保存/復号を担う。
 *
 * NOTE: process.env / 秘密鍵を参照するためサーバ専用。クライアントから import しないこと。
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { vercelConnections } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

const VERCEL_API = "https://api.vercel.com";
/** state の有効期間（OAuth 往復は短時間で完了する想定） */
const STATE_TTL_SEC = 10 * 60;
/** connect が state を載せる Cookie 名 */
export const OAUTH_STATE_COOKIE = "vc_oauth_state";

export function getClientId(): string | undefined {
  return process.env.VERCEL_OAUTH_CLIENT_ID;
}
export function getClientSecret(): string | undefined {
  return process.env.VERCEL_OAUTH_CLIENT_SECRET;
}
export function getIntegrationSlug(): string | undefined {
  return process.env.VERCEL_INTEGRATION_SLUG;
}

/** OAuth 連携に必要な env が揃っているか（未設定なら連携ボタンは無効にする）。 */
export function isVercelOAuthConfigured(): boolean {
  return Boolean(getClientId() && getClientSecret() && getIntegrationSlug());
}

/**
 * Vercel のインテグレーション・インストール(ライブ)URL。ユーザーはここでチームを選んで承認する。
 * 承認後、設定済みの Redirect URL に code/configurationId/teamId 付きで戻ってくる。
 *
 * NOTE: 旧 `/integrations/<slug>/new`（OAuth2 エントリポイント）は 2022 年に廃止され 404 になる。
 * 現行のライブURLは `/integrations/<slug>`（Integrations Console の「View Integration」と同じ）。
 */
export function buildInstallUrl(state: string): string {
  const slug = getIntegrationSlug();
  if (!slug) throw new Error("VERCEL_INTEGRATION_SLUG is not set");
  const u = new URL(`https://vercel.com/integrations/${slug}`);
  u.searchParams.set("state", state);
  return u.toString();
}

// ---- CSRF state（HMAC 署名 + 短命） ---------------------------------------

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}
function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function sign(payloadB64: string): string {
  return b64url(createHmac("sha256", secret()).update(payloadB64).digest());
}

/** 連携を開始する利用者に紐づく署名付き state（`<payload>.<sig>`）を発行する。 */
export function signState(ownerId: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + STATE_TTL_SEC;
  const nonce = b64url(randomBytes(12));
  const payload = b64url(
    Buffer.from(JSON.stringify({ o: ownerId, n: nonce, e: exp })),
  );
  return `${payload}.${sign(payload)}`;
}

/** state を検証して ownerId を返す。無効・失効・改竄なら null。 */
export function verifyState(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): { ownerId: string } | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: { o?: unknown; e?: unknown };
  try {
    data = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.o !== "string") return null;
  if (typeof data.e !== "number" || data.e < Math.floor(nowMs / 1000))
    return null;
  return { ownerId: data.o };
}

// ---- code → access_token 交換 ---------------------------------------------

export interface VercelTokenResponse {
  access_token: string;
  token_type?: string;
  installation_id?: string;
  user_id?: string;
  team_id?: string | null;
}

/**
 * 認可コードをアクセストークンに交換する。
 * redirect_uri は Integration 設定に登録した値と完全一致させること。
 */
export async function exchangeCodeForToken(args: {
  code: string;
  redirectUri: string;
}): Promise<VercelTokenResponse> {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("VERCEL_OAUTH_CLIENT_ID / SECRET が未設定です");
  }
  const res = await fetch(`${VERCEL_API}/v2/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: args.code,
      redirect_uri: args.redirectUri,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as
    | VercelTokenResponse
    | { error?: string; error_description?: string };
  if (!res.ok || !("access_token" in data) || !data.access_token) {
    const msg =
      ("error_description" in data && data.error_description) ||
      ("error" in data && data.error) ||
      `トークン交換に失敗しました (HTTP ${res.status})`;
    throw new Error(String(msg));
  }
  return data;
}

// ---- per-user 連携の保存/取得/削除 ----------------------------------------

export interface VercelConnectionPublic {
  connected: boolean;
  teamId: string | null;
  vercelUser: string | null;
}

/** 連携を保存（暗号化）。同一ユーザーは upsert で1行に保つ。 */
export async function saveConnection(args: {
  ownerId: string;
  accessToken: string;
  teamId?: string | null;
  installationId?: string | null;
  vercelUser?: string | null;
}): Promise<void> {
  const now = new Date();
  const accessTokenEnc = encryptSecret(args.accessToken);
  await db
    .insert(vercelConnections)
    .values({
      ownerId: args.ownerId,
      accessTokenEnc,
      teamId: args.teamId ?? null,
      installationId: args.installationId ?? null,
      vercelUser: args.vercelUser ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: vercelConnections.ownerId,
      set: {
        accessTokenEnc,
        teamId: args.teamId ?? null,
        installationId: args.installationId ?? null,
        vercelUser: args.vercelUser ?? null,
        updatedAt: now,
      },
    });
}

/** UI 表示用の連携状態（トークンは返さない）。 */
export async function getConnectionStatus(
  ownerId: string,
): Promise<VercelConnectionPublic> {
  const [row] = await db
    .select({
      teamId: vercelConnections.teamId,
      vercelUser: vercelConnections.vercelUser,
    })
    .from(vercelConnections)
    .where(eq(vercelConnections.ownerId, ownerId));
  if (!row) return { connected: false, teamId: null, vercelUser: null };
  return {
    connected: true,
    teamId: row.teamId ?? null,
    vercelUser: row.vercelUser ?? null,
  };
}

/** 公開処理で使う復号済みトークン。未連携なら null。 */
export async function getDecryptedToken(
  ownerId: string,
): Promise<{ token: string; teamId: string | null } | null> {
  const [row] = await db
    .select({
      accessTokenEnc: vercelConnections.accessTokenEnc,
      teamId: vercelConnections.teamId,
    })
    .from(vercelConnections)
    .where(eq(vercelConnections.ownerId, ownerId));
  if (!row) return null;
  return { token: decryptSecret(row.accessTokenEnc), teamId: row.teamId ?? null };
}

/** 連携を解除（行削除）。 */
export async function deleteConnection(ownerId: string): Promise<void> {
  await db
    .delete(vercelConnections)
    .where(eq(vercelConnections.ownerId, ownerId));
}
