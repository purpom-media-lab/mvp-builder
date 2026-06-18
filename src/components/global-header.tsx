"use client";

/**
 * 全画面共通のグローバルヘッダー（ナビゲーション）。
 * デスクトップは横並び、スマホ（sm 未満）はハンバーガーメニューに格納する。
 */
import { Menu, MoonIcon, SunIcon, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { LeanQuestLogo } from "@/components/leanquest-logo";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth/client";

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
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleTheme = () =>
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const handleSignOut = () =>
    signOut({ fetchOptions: { onSuccess: () => router.push("/sign-in") } });

  const ThemeButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="テーマ切替"
      onClick={toggleTheme}
    >
      <SunIcon className="h-4 w-4 scale-100 transition-transform dark:scale-0" />
      <MoonIcon className="absolute h-4 w-4 scale-0 transition-transform dark:scale-100" />
    </Button>
  );

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur-md sm:px-6">
      {/* 左: ロゴ + デスクトップナビ + センター */}
      <div className="flex min-w-0 items-center gap-5">
        <Link href="/studio" className="group flex shrink-0 items-center gap-2">
          <LeanQuestLogo className="h-5 w-auto text-foreground" />
          <span className="font-heading text-base font-bold tracking-tight">
            LEAN&nbsp;QUEST&nbsp;<span className="text-primary">AI</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-5 sm:flex">
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
        </nav>
        {center && (
          <div className="hidden min-w-0 truncate sm:block">{center}</div>
        )}
      </div>

      {/* 右: ページ操作 + デスクトップのユーザー操作 + モバイルのハンバーガー */}
      <div className="flex items-center gap-2 sm:gap-3">
        {right}
        <div className="hidden items-center gap-3 sm:flex">
          {ThemeButton}
          {data?.user && (
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <span className="hidden text-xs lg:inline">{data.user.email}</span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                サインアウト
              </Button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          aria-label="メニュー"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* モバイルメニュー */}
      {menuOpen && (
        <div className="absolute inset-x-0 top-full border-b border-border bg-background p-3 shadow-lg sm:hidden">
          <nav className="flex flex-col gap-0.5">
            {back && (
              <Link
                href={back.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                ← {back.label}
              </Link>
            )}
            <Link
              href="/studio"
              onClick={() => setMenuOpen(false)}
              className="rounded-md px-3 py-2 text-sm hover:bg-muted"
            >
              プロジェクト一覧
            </Link>
            {data?.user && (
              <Link
                href="/members"
                onClick={() => setMenuOpen(false)}
                className="rounded-md px-3 py-2 text-sm hover:bg-muted"
              >
                メンバー
              </Link>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
            >
              テーマ切替（{resolvedTheme === "dark" ? "ライト" : "ダーク"}）
            </button>
            {data?.user && (
              <div className="mt-1 border-t border-border pt-2">
                <p className="truncate px-3 text-xs text-muted-foreground">
                  {data.user.email}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1.5 w-full"
                  onClick={() => {
                    setMenuOpen(false);
                    handleSignOut();
                  }}
                >
                  サインアウト
                </Button>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
