"use client";

/**
 * 全画面共通のグローバルヘッダー（ナビゲーション）。
 * ロゴ（→ プロジェクト一覧）、任意の戻りリンク、ログインユーザー＋サインアウト。
 */
import { MoonIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { signOut, useSession } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";

export function GlobalHeader({
  back,
  center,
  right,
}: {
  back?: { href: string; label: string };
  center?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const router = useRouter();
  const { data } = useSession();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-2.5 backdrop-blur">
      <div className="flex items-center gap-4">
        <Link href="/studio" className="text-lg font-bold tracking-tight">
          MVP Builder
        </Link>
        {back && (
          <Link
            href={back.href}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {back.label}
          </Link>
        )}
        {data?.user && (
          <Link
            href="/members"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            メンバー
          </Link>
        )}
        {center}
      </div>
      <div className="flex items-center gap-3">
        {right}
        <Button
          variant="ghost"
          size="icon"
          aria-label="テーマ切替"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <SunIcon className="h-4 w-4 scale-100 transition-transform dark:scale-0" />
          <MoonIcon className="absolute h-4 w-4 scale-0 transition-transform dark:scale-100" />
        </Button>
        {data?.user && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden sm:inline">{data.user.email}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                signOut({
                  fetchOptions: { onSuccess: () => router.push("/sign-in") },
                })
              }
            >
              サインアウト
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
