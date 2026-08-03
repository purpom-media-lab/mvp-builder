/**
 * Claude Code など外部 MCP クライアント向けのパーソナルトークン。
 *
 * /api/mcp（MCP サーバー）へ Authorization: Bearer で渡す長命トークン。
 * export-token.ts と同じ HMAC 署名のステートレス検証だが、
 * - スコープが「プロジェクト単位」ではなく「ユーザー単位」（ownerId のみ）
 * - kind タグ ("mcp") を含み、Figma エクスポートトークンとは相互流用できない
 * 点が異なる。鍵は同じく BETTER_AUTH_SECRET。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_DEFAULT_SEC = 60 * 60 * 24 * 90; // 90日

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

/**
 * トークンの権限。
 *
 * `read`  … 成果物の閲覧のみ（従来の6ツール）
 * `write` … 加えて成果物の書き戻し（`save_step`）。**既存の成果物を洗い替える**
 *
 * 署名ペイロードに `s` が無い古いトークンは `read` として扱う。書き込みを
 * 足したときに、発行済みトークンが黙って書き込み可になるのを避けるため
 * （漏れたときの影響が「閲覧」から「上書き・破壊」に変わってしまう）。
 */
export type McpScope = "read" | "write";

export interface McpTokenClaims {
  ownerId: string;
  /** 失効時刻（unix 秒） */
  exp: number;
  scope: McpScope;
}

/** ユーザー単位の MCP トークンを発行する。`<payload>.<sig>` 形式。 */
export function signMcpToken(
  ownerId: string,
  ttlSec: number = TTL_DEFAULT_SEC,
  nowMs: number = Date.now(),
  scope: McpScope = "read",
): { token: string; expiresAt: Date } {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = b64url(
    Buffer.from(JSON.stringify({ k: "mcp", o: ownerId, e: exp, s: scope })),
  );
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt: new Date(exp * 1000),
  };
}

/** MCP トークンを検証する。無効・失効・改竄・kind 不一致なら null。 */
export function verifyMcpToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): McpTokenClaims | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: { k?: unknown; o?: unknown; e?: unknown; s?: unknown };
  try {
    data = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (data.k !== "mcp" || typeof data.o !== "string") return null;
  if (typeof data.e !== "number" || data.e < Math.floor(nowMs / 1000))
    return null;
  // スコープ未指定（write 導入前に発行されたトークン）は read に落とす。
  const scope: McpScope = data.s === "write" ? "write" : "read";
  return { ownerId: data.o, exp: data.e, scope };
}
