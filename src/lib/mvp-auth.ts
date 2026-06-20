/**
 * 公開MVP（/run/[projectId]）のエンドユーザー認証ヘルパー（サーバ専用）。
 *
 * 外部依存を増やさず Node 標準 `crypto` だけで以下を提供する:
 *  - パスワードハッシュ: scrypt + ランダムソルト（保存形式 `scrypt$N$salt$hash`）
 *  - セッショントークン: HMAC-SHA256 署名付きの自前トークン（`base64url(payload).base64url(sig)`）
 *
 * 署名鍵は `BETTER_AUTH_SECRET` を流用する（サーバ専用・クライアントへ出さない）。
 * トークンは projectId にスコープされ、他プロジェクトのトークンは検証で弾く。
 */
import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { db } from "@/lib/db";
import { mvpEndUsers } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

/** options 付き scrypt を Promise 化（promisify の型がオプションを受けないため自前で包む）。 */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** scrypt のコストパラメータ（N=2^14）。保存形式に含めて将来変更に強くする。 */
const SCRYPT_N = 16384;
const KEY_LEN = 64;
const SALT_BYTES = 16;

/** トークン有効期間（7日）。 */
const TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) {
    throw new Error("BETTER_AUTH_SECRET が未設定です（トークン署名に必要）");
  }
  return s;
}

function base64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** パスワードをソルト付き scrypt でハッシュ。保存可能な単一文字列を返す。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
  })) as Buffer;
  return `scrypt$${SCRYPT_N}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** 平文パスワードと保存済みハッシュを定数時間で照合。 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  if (!Number.isInteger(n) || n <= 0) return false;
  const salt = Buffer.from(parts[2], "hex");
  const expected = Buffer.from(parts[3], "hex");
  let derived: Buffer;
  try {
    derived = (await scrypt(password, salt, expected.length, {
      N: n,
    })) as Buffer;
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export interface TokenPayload {
  userId: string;
  projectId: string;
  /** 失効時刻（UNIX 秒）。 */
  exp: number;
}

function sign(data: string): string {
  return base64urlEncode(createHmac("sha256", secret()).update(data).digest());
}

/**
 * 署名付きトークンを発行する。`nowSec` は呼び出し側が現在時刻(UNIX秒)を渡す。
 * （ライブラリ内で Date を直接読まず、テスト容易性のため引数で受ける）
 */
export function issueToken(
  userId: string,
  projectId: string,
  nowSec: number,
): string {
  const payload: TokenPayload = {
    userId,
    projectId,
    exp: nowSec + TOKEN_TTL_SEC,
  };
  const body = base64urlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/**
 * トークンを検証する。署名不一致 / 期限切れ / projectId 不一致なら null。
 * `nowSec` は現在時刻(UNIX秒)。
 */
export function verifyToken(
  token: string,
  projectId: string,
  nowSec: number,
): TokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // 署名を定数時間で照合
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: TokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(body).toString("utf8"));
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.userId !== "string" ||
    typeof payload.projectId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.projectId !== projectId) return null;
  if (payload.exp <= nowSec) return null;
  return payload;
}

/** Authorization ヘッダから Bearer トークンを取り出す（無ければ null）。 */
export function bearerFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/**
 * リクエストの Bearer トークンを検証し、対象プロジェクトの認証ユーザーIDを返す。
 * トークンが無い / 無効 / 期限切れ / 別プロジェクトなら null（= 匿名扱い）。
 */
export function authedUserId(req: Request, projectId: string): string | null {
  const token = bearerFromRequest(req);
  if (!token) return null;
  const payload = verifyToken(token, projectId, Math.floor(Date.now() / 1000));
  return payload?.userId ?? null;
}

export interface EndUser {
  id: string;
  email: string;
  name: string | null;
}

/** email の軽い正規化＋形式チェック。 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

/** name のサニタイズ（任意・最大長制限）。 */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim();
  if (!n) return null;
  return n.slice(0, 120);
}

/** projectId+email のエンドユーザーを取得（無ければ null）。 */
export async function findEndUserByEmail(
  projectId: string,
  email: string,
): Promise<{ id: string; email: string; name: string | null; passwordHash: string } | null> {
  const [row] = await db
    .select({
      id: mvpEndUsers.id,
      email: mvpEndUsers.email,
      name: mvpEndUsers.name,
      passwordHash: mvpEndUsers.passwordHash,
    })
    .from(mvpEndUsers)
    .where(
      and(eq(mvpEndUsers.projectId, projectId), eq(mvpEndUsers.email, email)),
    );
  return row ?? null;
}

/** id でエンドユーザーを取得（projectId スコープ・無ければ null）。 */
export async function findEndUserById(
  projectId: string,
  id: string,
): Promise<EndUser | null> {
  const [row] = await db
    .select({
      id: mvpEndUsers.id,
      email: mvpEndUsers.email,
      name: mvpEndUsers.name,
    })
    .from(mvpEndUsers)
    .where(and(eq(mvpEndUsers.projectId, projectId), eq(mvpEndUsers.id, id)));
  return row ?? null;
}

/** エンドユーザーを作成して返す。 */
export async function createEndUser(
  projectId: string,
  email: string,
  passwordHash: string,
  name: string | null,
): Promise<EndUser> {
  const [row] = await db
    .insert(mvpEndUsers)
    .values({ projectId, email, passwordHash, name })
    .returning({
      id: mvpEndUsers.id,
      email: mvpEndUsers.email,
      name: mvpEndUsers.name,
    });
  return row;
}
