/** サーバ側でセッション/ユーザーを取得するヘルパー（Better Auth） */
import { auth } from "./auth";

export async function getSessionUser(reqHeaders: Headers) {
  const session = await auth.api.getSession({ headers: reqHeaders });
  return session?.user ?? null;
}
