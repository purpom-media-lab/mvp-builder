/** Better Auth サーバ設定（Drizzle/Neon アダプタ + Email/Password） */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { db } from "@/lib/db";
import { account, session, user, verification } from "@/lib/db/auth-schema";
import { hasPendingInvitation } from "@/lib/invitations";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    // オープン登録は許可せず、招待ゲート（下記 hooks.before）で
    // 「招待されたメールのみ」サインアップを通す。
    enabled: true,
  },
  hooks: {
    // サインアップは有効な招待があるメールに限定する（招待制）。
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const email = String(
          (ctx.body as { email?: string } | undefined)?.email ?? "",
        );
        if (!email || !(await hasPendingInvitation(email))) {
          throw new APIError("FORBIDDEN", {
            message: "登録には有効な招待が必要です。",
            code: "INVITE_REQUIRED",
          });
        }
      }
    }),
  },
  // ビルド時のフォールバック。本番は必ず BETTER_AUTH_SECRET を設定すること。
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "dev-only-insecure-secret-change-in-production-0000",
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});
