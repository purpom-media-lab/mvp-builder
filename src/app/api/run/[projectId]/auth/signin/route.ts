/**
 * 公開MVP エンドユーザー: サインイン（公開・projectId スコープ）。
 *
 * POST { email, password } → 検証して署名付きトークンを返す。
 * 失敗時は 401（メール・パスワードのどちらが誤りかは明かさない）。
 */
import { NextResponse } from "next/server";
import {
  findEndUserByEmail,
  issueToken,
  normalizeEmail,
  verifyPassword,
} from "@/lib/mvp-auth";
import { projectExists } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!(await projectExists(projectId))) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : null;
  if (!email || !password) {
    return NextResponse.json(
      { error: "メールアドレスとパスワードを入力してください" },
      { status: 400 },
    );
  }

  const user = await findEndUserByEmail(projectId, email);
  // ユーザー不在でも verifyPassword を通し、列挙・タイミング差を抑える
  const ok = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, "scrypt$16384$00$00");

  if (!user || !ok) {
    return NextResponse.json(
      { error: "メールアドレスまたはパスワードが正しくありません" },
      { status: 401 },
    );
  }

  const token = issueToken(user.id, projectId, Math.floor(Date.now() / 1000));
  return NextResponse.json({
    token,
    user: { id: user.id, email: user.email, name: user.name },
  });
}
