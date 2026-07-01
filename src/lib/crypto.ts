/**
 * 機密値（OAuth アクセストークン等）の対称暗号化 — サーバ専用。
 *
 * AES-256-GCM。鍵は `BETTER_AUTH_SECRET` から SHA-256 で 32 バイトに派生する
 * （別途キー管理を持たないための実用的な選択）。出力は `iv:tag:cipher`（各 base64）。
 *
 * NOTE: process.env を参照するためサーバ専用。クライアントから import しないこと。
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM 推奨 96bit

function key(): Buffer {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  // 任意長のシークレットを固定 32 バイト鍵へ派生
  return createHash("sha256").update(s).digest();
}

/** 平文を暗号化して `iv:tag:cipher`（各 base64）形式の文字列を返す。 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

/** `encryptSecret` の出力を復号する。改竄・不正フォーマットは例外を投げる。 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}
