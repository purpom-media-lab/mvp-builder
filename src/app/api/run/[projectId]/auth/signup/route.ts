/**
 * 公開MVP エンドユーザー: サインアップ（公開・projectId スコープ）。
 *
 * POST { email, password, name? } → ユーザー作成し、署名付きトークンを返す。
 * 同一 projectId+email が既にあれば 409。
 */
import { NextResponse } from "next/server";
import {
  createEndUser,
  findEndUserByEmail,
  hashPassword,
  issueToken,
  normalizeEmail,
  sanitizeName,
} from "@/lib/mvp-auth";
import { projectExists } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;

export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!(await projectExists(projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { error: "有効なメールアドレスを入力してください" },
      { status: 400 },
    );
  }
  if (
    typeof body.password !== "string" ||
    body.password.length < MIN_PASSWORD_LEN ||
    body.password.length > MAX_PASSWORD_LEN
  ) {
    return NextResponse.json(
      { error: `パスワードは${MIN_PASSWORD_LEN}文字以上で入力してください` },
      { status: 400 },
    );
  }
  const name = sanitizeName(body.name);

  // 重複チェック（ユニーク制約とあわせて二重に守る）
  const existing = await findEndUserByEmail(projectId, email);
  if (existing) {
    return NextResponse.json(
      { error: "このメールアドレスは既に登録されています" },
      { status: 409 },
    );
  }

  try {
    const passwordHash = await hashPassword(body.password);
    const user = await createEndUser(projectId, email, passwordHash, name);
    const token = issueToken(user.id, projectId, Math.floor(Date.now() / 1000));
    return NextResponse.json({ token, user }, { status: 201 });
  } catch {
    // ユニーク制約違反（競合）も含めてここに来うる
    const dup = await findEndUserByEmail(projectId, email);
    if (dup) {
      return NextResponse.json(
        { error: "このメールアドレスは既に登録されています" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "登録に失敗しました" },
      { status: 500 },
    );
  }
}
