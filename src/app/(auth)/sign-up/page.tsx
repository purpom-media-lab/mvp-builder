import { redirect } from "next/navigation";

/**
 * 新規登録は公開運用のため無効化済み（better-auth の disableSignUp）。
 * このページに来たユーザーはサインインへ誘導する。
 */
export default function SignUpPage() {
  redirect("/sign-in");
}
