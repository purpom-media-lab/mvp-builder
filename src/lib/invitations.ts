/**
 * メンバー招待の永続化（サーバ専用）。
 *
 * オープン登録は無効化済み（better-auth disableSignUp 相当の招待ゲート）。
 * 招待されたメールのみが新規アカウントを作成できる。
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { user } from "@/lib/db/auth-schema";
import { invitations } from "@/lib/db/schema";

const EXPIRY_DAYS = 7;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

/** URL-safe な招待トークンを生成 */
export function generateToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * 招待を発行する。既存ユーザー宛は拒否。同一メールの既存 pending は revoke して再発行。
 */
export async function createInvitation(inviterId: string, emailRaw: string) {
  const email = normalizeEmail(emailRaw);
  if (!email || !email.includes("@")) {
    throw new Error("有効なメールアドレスを入力してください");
  }

  const [existingUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, email));
  if (existingUser) {
    throw new Error("そのメールアドレスは既に登録済みです");
  }

  // 既存の pending を無効化してから新規発行（リンクは常に最新の1本）
  await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.email, email), eq(invitations.status, "pending")));

  const token = generateToken();
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(invitations)
    .values({ email, token, invitedBy: inviterId, expiresAt })
    .returning();
  return row;
}

/** 招待一覧（全件・新しい順） */
export async function listInvitations() {
  return db.select().from(invitations).orderBy(desc(invitations.createdAt));
}

/** pending の招待を取り消す */
export async function revokeInvitation(id: string) {
  await db
    .update(invitations)
    .set({ status: "revoked" })
    .where(and(eq(invitations.id, id), eq(invitations.status, "pending")));
}

/** トークンから有効な（pending かつ未期限切れ）招待を取得 */
export async function getValidInvitationByToken(token: string) {
  const [row] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, token),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/** 指定メール宛の有効な招待が存在するか（サインアップのゲートに使用） */
export async function hasPendingInvitation(emailRaw: string) {
  const email = normalizeEmail(emailRaw);
  const [row] = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.status, "pending"),
        gt(invitations.expiresAt, new Date()),
      ),
    );
  return !!row;
}

/** 招待を承諾済みにする（承諾後の user.id を記録） */
export async function markAccepted(token: string, userId: string) {
  await db
    .update(invitations)
    .set({ status: "accepted", acceptedUserId: userId, acceptedAt: new Date() })
    .where(and(eq(invitations.token, token), eq(invitations.status, "pending")));
}

/** メンバー（登録済みユーザー）一覧 */
export async function listMembers() {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(desc(user.createdAt));
}
