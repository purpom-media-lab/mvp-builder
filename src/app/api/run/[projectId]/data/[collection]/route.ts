/**
 * 「本実装」ランタイム・データAPI（公開・ビルダー認証なし）。
 *
 * projectId + collection スコープで共有テーブル `mvp_records` を読み書きする。
 * 同一オリジン配信なので CORS は不要だが、公開エンドポイントなので
 * projectId 実在チェック / collection サニタイズ / data バリデーション（型・サイズ）
 * を必ず行う。
 *
 * 注意: 現状エンドユーザー認証は無い（ownerKey は匿名ブラウザID）。Phase2 で追加予定。
 */
import { NextResponse } from "next/server";
import {
  createRecord,
  deleteRecord,
  listRecords,
  sanitizeCollection,
  sanitizeOwnerKey,
  validateData,
} from "@/lib/mvp-runtime";
import { projectExists } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string; collection: string }> };

type Resolved =
  | { ok: true; projectId: string; collection: string }
  | { ok: false; res: NextResponse };

/** projectId 実在 + collection サニタイズをまとめて検証。 */
async function resolve(
  params: Promise<{ projectId: string; collection: string }>,
): Promise<Resolved> {
  const { projectId, collection: rawCollection } = await params;

  const collection = sanitizeCollection(rawCollection);
  if (!collection) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Invalid collection" }, { status: 400 }),
    };
  }
  if (!(await projectExists(projectId))) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Project not found" }, { status: 404 }),
    };
  }
  return { ok: true, projectId, collection };
}

export async function GET(req: Request, { params }: Ctx) {
  const r = await resolve(params);
  if (!r.ok) return r.res;

  const url = new URL(req.url);
  const owner = sanitizeOwnerKey(url.searchParams.get("owner"));
  try {
    const records = await listRecords(r.projectId, r.collection, owner);
    return NextResponse.json({ records });
  } catch {
    return NextResponse.json({ error: "Failed to list" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const r = await resolve(params);
  if (!r.ok) return r.res;

  let body: { data?: unknown; ownerKey?: unknown };
  try {
    body = (await req.json()) as { data?: unknown; ownerKey?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const valid = validateData(body.data);
  if (!valid.ok) {
    return NextResponse.json({ error: valid.error }, { status: 400 });
  }
  const owner =
    typeof body.ownerKey === "string"
      ? sanitizeOwnerKey(body.ownerKey)
      : null;

  try {
    const record = await createRecord(
      r.projectId,
      r.collection,
      valid.data,
      owner,
    );
    return NextResponse.json(record, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to create" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const r = await resolve(params);
  if (!r.ok) return r.res;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const owner = sanitizeOwnerKey(url.searchParams.get("owner"));

  try {
    const ok = await deleteRecord(r.projectId, r.collection, id, owner);
    if (!ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
