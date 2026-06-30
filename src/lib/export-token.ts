/**
 * Figma エクスポート用の短命トークン（Approach B / Phase 2）。
 *
 * Figma プラグインは所有者のセッション Cookie を送れない（CORS/別オリジン）。
 * そこで、Studio（所有者セッション）が署名付きトークンを発行し、その URL を
 * プラグインに渡す。トークンは projectId / ownerId / 失効時刻を含む HMAC 署名で、
 * DB を持たないステートレス検証（BETTER_AUTH_SECRET を鍵に使用）。
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_DEFAULT_SEC = 60 * 60; // 1時間

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

export interface ExportTokenClaims {
  projectId: string;
  ownerId: string;
}

/** 署名付きトークンを発行する。`<payload>.<sig>` 形式。 */
export function signExportToken(
  projectId: string,
  ownerId: string,
  ttlSec: number = TTL_DEFAULT_SEC,
  nowMs: number = Date.now(),
): string {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const payload = b64url(
    Buffer.from(JSON.stringify({ p: projectId, o: ownerId, e: exp })),
  );
  return `${payload}.${sign(payload)}`;
}

/** トークンを検証する。無効・失効・改竄なら null。 */
export function verifyExportToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): ExportTokenClaims | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: { p?: unknown; o?: unknown; e?: unknown };
  try {
    data = JSON.parse(fromB64url(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.p !== "string" || typeof data.o !== "string") return null;
  if (typeof data.e !== "number" || data.e < Math.floor(nowMs / 1000))
    return null;
  return { projectId: data.p, ownerId: data.o };
}
