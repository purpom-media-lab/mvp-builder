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
import { buildFeedbackWidget } from "@/lib/feedback-widget";

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
 * 配信する素の JS SDK。ビルド不要の文字列。PROJECT_ID は配信時に埋め込む。
 *
 *   window.LQ.db(collection)
 *     - .list(opts)    → レコード配列。opts.mine=true で自分の分だけ（認証時=ログインユーザー、
 *                        未認証=匿名ブラウザID）。
 *     - .create(data)  → 1件作成（作成レコードを返す）
 *     - .remove(id)    → 1件削除
 *   window.LQ.auth
 *     - .signup(email, password, name?) → 登録してログイン（トークンを保存）
 *     - .signin(email, password)        → ログイン（トークンを保存）
 *     - .signout()                      → ログアウト（トークン破棄）
 *     - .user()                         → 現在のユーザー {id,email,name} or null（/me 結果をキャッシュ）
 *   window.LQ.storage
 *     - .upload(file) → S3 にアップロードして { url } を返す
 *
 * 認証トークンは localStorage("lq_token") に保存し、db/storage の各 fetch に
 * Authorization: Bearer を付与する。認証時はサーバ側で ownerKey=ユーザーID に上書きされる。
 *
 * projectId は UUID（route 側で実在チェック済み）のみが渡る前提だが、
 * 念のため JSON.stringify で安全に埋め込む（XSS/ブレイクアウト防止）。
 *
 * apiOrigin: 別オリジン（ユーザーの Vercel 等）に配信する場合に、API 呼び出しを
 * ビルダーの絶対URLへ向けるためのオリジン（例 "https://builder.example.com"）。
 * 省略（"" ）時は相対パス＝同一オリジン配信（/run のビルダーホスティング）。
 */
export function buildRuntimeSdk(projectId: string, apiOrigin = ""): string {
  const pid = JSON.stringify(projectId);
  const origin = JSON.stringify(apiOrigin.replace(/\/+$/, ""));
  return `(function(){
  var PROJECT_ID = ${pid};
  var API_ORIGIN = ${origin};
  var BASE = API_ORIGIN + "/api/run/" + PROJECT_ID + "/data/";
  var AUTH_BASE = API_ORIGIN + "/api/run/" + PROJECT_ID + "/auth/";
  var UPLOAD_URL = API_ORIGIN + "/api/run/" + PROJECT_ID + "/upload";
  var TOKEN_KEY = "lq_token";
  var userCache; // /me のキャッシュ（undefined=未取得, null=未ログイン）

  function getToken(){
    try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
  }
  function setToken(t){
    try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    userCache = undefined; // トークン変化でキャッシュ無効化
  }
  function authHeaders(extra){
    var h = extra || {};
    var t = getToken();
    if (t) h["authorization"] = "Bearer " + t;
    return h;
  }
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
        if (opts && opts.mine) {
          // 認証時はサーバが token から所有者を解決（mine=1）。未認証は匿名キーで絞る。
          url += getToken() ? "?mine=1" : (key ? "?owner=" + encodeURIComponent(key) : "");
        }
        return fetch(url, { headers: authHeaders({ "accept": "application/json" }) })
          .then(function(r){ return r.json(); })
          .then(function(j){ return (j && j.records) ? j.records : []; });
      },
      create: function(data){
        return fetch(BASE + col, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json" }),
          body: JSON.stringify({ data: data, ownerKey: key })
        }).then(function(r){ return r.json(); });
      },
      remove: function(id){
        var url = BASE + col + "?id=" + encodeURIComponent(id);
        if (!getToken() && key) url += "&owner=" + encodeURIComponent(key);
        return fetch(url, { method: "DELETE", headers: authHeaders() })
          .then(function(r){ return r.json(); });
      }
    };
  }

  function postAuth(path, body){
    return fetch(AUTH_BASE + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(r){
      return r.json().then(function(j){
        if (!r.ok) throw new Error((j && j.error) || "リクエストに失敗しました");
        return j;
      });
    });
  }
  var auth = {
    signup: function(email, password, name){
      return postAuth("signup", { email: email, password: password, name: name }).then(function(j){
        setToken(j.token); userCache = j.user || null; return j.user;
      });
    },
    signin: function(email, password){
      return postAuth("signin", { email: email, password: password }).then(function(j){
        setToken(j.token); userCache = j.user || null; return j.user;
      });
    },
    signout: function(){ setToken(null); userCache = null; },
    token: function(){ return getToken(); },
    user: function(){
      if (userCache !== undefined) return Promise.resolve(userCache);
      if (!getToken()) { userCache = null; return Promise.resolve(null); }
      return fetch(AUTH_BASE + "me", { headers: authHeaders({ "accept": "application/json" }) })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ userCache = (j && j.user) ? j.user : null; if (!userCache) setToken(null); return userCache; })
        .catch(function(){ return null; });
    }
  };

  var storage = {
    upload: function(file){
      var fd = new FormData();
      fd.append("file", file);
      if (!getToken()) { var k = ownerKey(); if (k) fd.append("ownerKey", k); }
      return fetch(UPLOAD_URL, { method: "POST", headers: authHeaders(), body: fd })
        .then(function(r){
          return r.json().then(function(j){
            if (!r.ok) throw new Error((j && j.error) || "アップロードに失敗しました");
            return j; // { url, name, size, contentType }
          });
        });
    }
  };

  window.LQ = { db: db, auth: auth, storage: storage, projectId: PROJECT_ID };
})();`;
}

/**
 * プロトタイプ HTML に LQ ランタイム SDK ＋ フィードバックウィジェットの <script> を注入する。
 * SDK は `</head>` 直前（無ければ先頭）、ウィジェットは `</body>` 直前（無ければ末尾）に置く。
 *
 * apiOrigin を渡すと API 呼び出しを絶対URL（ビルダーオリジン）に向ける。これにより
 * 別オリジン（ユーザーの Vercel 等）に配信した MVP からもビルダーの BaaS を利用できる。
 * 省略時は相対パス＝同一オリジン配信（/run のビルダーホスティング）。
 */
export function injectRuntimeSdk(
  html: string,
  projectId: string,
  apiOrigin = "",
): string {
  const sdkTag = `<script>\n${buildRuntimeSdk(projectId, apiOrigin)}\n</script>`;
  const widgetTag = `<script>\n${buildFeedbackWidget(projectId, apiOrigin)}\n</script>`;
  let out = html;
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, `${sdkTag}\n</head>`);
  } else {
    out = `${sdkTag}\n${out}`;
  }
  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${widgetTag}\n</body>`);
  }
  return `${out}\n${widgetTag}`;
}
