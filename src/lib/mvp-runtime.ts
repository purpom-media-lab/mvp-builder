/**
 * 「本実装」ランタイム（共有マルチテナント）。
 *
 * 各プロジェクト(=公開MVP)のフォーム等のデータを共有テーブル `mvp_records` に
 * projectId スコープで保存する。ビルダー側の認証は通さない公開ランタイムなので、
 * - projectId は必ず実在チェック（呼び出し側）
 * - collection 名はサニタイズ
 * - data はオブジェクトのみ・サイズ上限
 * を徹底する。
 *
 * 注意: 現状エンドユーザー認証は無く、ownerKey は匿名ブラウザID（localStorage）。
 *       本格的なアクセス制御は Phase2 で追加予定。
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mvpRecords } from "@/lib/db/schema";

/** data(JSON) の最大サイズ（バイト相当・JSON文字列長で判定）。 */
export const MAX_DATA_BYTES = 100 * 1024; // 100KB

/** collection 名の最大長 */
const MAX_COLLECTION_LEN = 64;

/**
 * collection 名をサニタイズして安全な識別子だけ許可する。
 * 英数字・ハイフン・アンダースコアのみ。空や長すぎる場合は null。
 */
export function sanitizeCollection(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim();
  if (!c || c.length > MAX_COLLECTION_LEN) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(c)) return null;
  return c;
}

/** data が「プレーンなオブジェクト」かつサイズ上限内かを検証。 */
export function validateData(
  value: unknown,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return { ok: false, error: "data はオブジェクトである必要があります" };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, error: "data をシリアライズできません" };
  }
  if (serialized.length > MAX_DATA_BYTES) {
    return { ok: false, error: "data のサイズが上限(100KB)を超えています" };
  }
  return { ok: true, data: value as Record<string, unknown> };
}

/** ownerKey の最大長（匿名ブラウザID想定）。長すぎる入力は弾く。 */
const MAX_OWNER_KEY_LEN = 128;

export function sanitizeOwnerKey(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const k = raw.trim();
  if (!k || k.length > MAX_OWNER_KEY_LEN) return null;
  return k;
}

export interface PublicRecord {
  id: string;
  data: Record<string, unknown>;
  createdAt: Date;
}

/** projectId + collection のレコード一覧（任意で ownerKey 絞り込み）。新しい順。 */
export async function listRecords(
  projectId: string,
  collection: string,
  ownerKey?: string | null,
): Promise<PublicRecord[]> {
  const where = ownerKey
    ? and(
        eq(mvpRecords.projectId, projectId),
        eq(mvpRecords.collection, collection),
        eq(mvpRecords.ownerKey, ownerKey),
      )
    : and(
        eq(mvpRecords.projectId, projectId),
        eq(mvpRecords.collection, collection),
      );

  const rows = await db
    .select({
      id: mvpRecords.id,
      data: mvpRecords.data,
      createdAt: mvpRecords.createdAt,
    })
    .from(mvpRecords)
    .where(where)
    .orderBy(desc(mvpRecords.createdAt));

  return rows.map((r) => ({
    id: r.id,
    data: r.data ?? {},
    createdAt: r.createdAt,
  }));
}

/** 1件作成して作成レコードを返す。 */
export async function createRecord(
  projectId: string,
  collection: string,
  data: Record<string, unknown>,
  ownerKey?: string | null,
): Promise<PublicRecord> {
  const [row] = await db
    .insert(mvpRecords)
    .values({
      projectId,
      collection,
      ownerKey: ownerKey ?? null,
      data,
    })
    .returning({
      id: mvpRecords.id,
      data: mvpRecords.data,
      createdAt: mvpRecords.createdAt,
    });
  return { id: row.id, data: row.data ?? {}, createdAt: row.createdAt };
}

/**
 * 1件削除。projectId スコープ必須（他プロジェクトの行は消せない）。
 * ownerKey を渡すと、その所有者の行に限定する。
 * 削除できた件数(>0)で成否を返す。
 */
export async function deleteRecord(
  projectId: string,
  collection: string,
  id: string,
  ownerKey?: string | null,
): Promise<boolean> {
  const conds = [
    eq(mvpRecords.id, id),
    eq(mvpRecords.projectId, projectId),
    eq(mvpRecords.collection, collection),
  ];
  if (ownerKey) conds.push(eq(mvpRecords.ownerKey, ownerKey));

  const deleted = await db
    .delete(mvpRecords)
    .where(and(...conds))
    .returning({ id: mvpRecords.id });
  return deleted.length > 0;
}

/**
 * 配信する素の JS SDK。ビルド不要の文字列。`window.LQ.db(collection)` を提供する。
 *   - .list()        → そのコレクションのレコード配列（data の配列）
 *   - .create(data)  → 1件作成（作成レコードを返す）
 *   - .remove(id)    → 1件削除
 * ownerKey は localStorage の匿名UUID。PROJECT_ID は配信時に埋め込む。
 *
 * projectId は UUID（route 側で実在チェック済み）のみが渡る前提だが、
 * 念のため JSON.stringify で安全に埋め込む（XSS/ブレイクアウト防止）。
 */
export function buildRuntimeSdk(projectId: string): string {
  const pid = JSON.stringify(projectId);
  return `(function(){
  var PROJECT_ID = ${pid};
  var BASE = "/api/run/" + PROJECT_ID + "/data/";
  function ownerKey(){
    try {
      var k = localStorage.getItem("lq_owner_key");
      if (!k) {
        k = (crypto && crypto.randomUUID) ? crypto.randomUUID()
          : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem("lq_owner_key", k);
      }
      return k;
    } catch (e) { return null; }
  }
  function db(collection){
    var col = encodeURIComponent(collection);
    var key = ownerKey();
    return {
      list: function(opts){
        var url = BASE + col;
        if (opts && opts.mine && key) url += "?owner=" + encodeURIComponent(key);
        return fetch(url, { headers: { "accept": "application/json" } })
          .then(function(r){ return r.json(); })
          .then(function(j){ return (j && j.records) ? j.records : []; });
      },
      create: function(data){
        return fetch(BASE + col, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: data, ownerKey: key })
        }).then(function(r){ return r.json(); });
      },
      remove: function(id){
        var url = BASE + col + "?id=" + encodeURIComponent(id);
        if (key) url += "&owner=" + encodeURIComponent(key);
        return fetch(url, { method: "DELETE" })
          .then(function(r){ return r.json(); });
      }
    };
  }
  window.LQ = { db: db, projectId: PROJECT_ID };
})();`;
}
