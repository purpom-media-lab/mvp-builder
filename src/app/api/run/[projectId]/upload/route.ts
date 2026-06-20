/**
 * 公開MVP: ファイルアップロード（公開・projectId スコープ）。
 *
 * POST multipart/form-data（フィールド名 `file`）でファイルを受け取り、S3 に
 *   run/<projectId>/<ownerKey>/<uuid>-<sanitizedName>
 * のキーで保存して、CloudFront 経由の公開URL { url } を返す。
 *
 * - サイズ上限 10MB / ファイル名はサニタイズ。
 * - 認証トークンがあれば ownerKey = エンドユーザーID、無ければ匿名 owner（任意）。
 * - S3 未設定（isS3Configured=false）時は 400「ストレージ未設定」。
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authedUserId, bearerFromRequest, verifyToken } from "@/lib/mvp-auth";
import { sanitizeOwnerKey } from "@/lib/mvp-runtime";
import { projectExists } from "@/lib/projects";
import { isS3Configured, putObject } from "@/lib/s3-publish";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

/** アップロード上限（10MB）。 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** ファイル名をサニタイズ（パス区切り・危険文字除去、最大長制限）。 */
function sanitizeFilename(raw: string): string {
  // パス成分を捨てて末尾のみ採用
  const base = raw.split(/[\\/]/).pop() ?? "file";
  // 許可: 英数字・ドット・ハイフン・アンダースコア。それ以外は _ に。
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  const safe = cleaned.slice(0, 100);
  return safe || "file";
}

/** ownerKey を決める: 認証済みはユーザーID、未認証はフォーム/クエリの匿名キー or "anon"。 */
function resolveOwnerKey(
  req: Request,
  projectId: string,
  formOwner: string | null,
): string {
  const auth = authedUserId(req, projectId);
  if (auth) return auth;
  const anon = sanitizeOwnerKey(formOwner);
  return anon ?? "anon";
}

export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!(await projectExists(projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!isS3Configured()) {
    return NextResponse.json({ error: "ストレージ未設定" }, { status: 400 });
  }

  // Authorization があるのに無効/期限切れなら 401（公開だが偽トークンは弾く）
  const token = bearerFromRequest(req);
  if (token && !verifyToken(token, projectId, Math.floor(Date.now() / 1000))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "multipart/form-data で送信してください" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "file フィールドにファイルを指定してください" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "空のファイルです" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "ファイルサイズが上限(10MB)を超えています" },
      { status: 400 },
    );
  }

  const ownerKey = resolveOwnerKey(
    req,
    projectId,
    typeof form.get("ownerKey") === "string"
      ? (form.get("ownerKey") as string)
      : null,
  );
  const filename = sanitizeFilename(file.name || "file");
  const contentType = file.type || "application/octet-stream";
  const key = `run/${projectId}/${encodeURIComponent(ownerKey)}/${randomUUID()}-${filename}`;

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    // 念のためサーバ側でも実バイト数を確認
    if (buf.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "ファイルサイズが上限(10MB)を超えています" },
        { status: 400 },
      );
    }
    const url = await putObject(key, buf, contentType);
    return NextResponse.json(
      { url, name: filename, size: buf.byteLength, contentType },
      { status: 201 },
    );
  } catch {
    return NextResponse.json(
      { error: "アップロードに失敗しました" },
      { status: 500 },
    );
  }
}
