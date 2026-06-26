"use client";

/**
 * 認証エリア共通のアプリシェル（daisyUI 5 drawer + navbar + menu）。
 *
 * lg 以上では左サイドバー（drawer lg:drawer-open）を常時表示、モバイルでは
 * navbar のハンバーガーでトグルする。グローバル主ナビは Project 中心に小さく保ち、
 * アカウント/テーマ/サインアウトは navbar 右の dropdown に集約する。
 *
 * 既存 GlobalHeader の API（back / center / right）を踏襲し、各ページ固有の
 * ツールバー（right）をそのまま navbar に載せられるようにしている。
 */
import { Menu, MoonIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { LeanQuestLogo } from "@/components/leanquest-logo";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth/client";

/** グローバル主ナビ（Project コレクション中心・小さく保つ）。 */
const NAV_ITEMS: { href: string; label: string; icon: string }[] = [
  { href: "/studio", label: "プロジェクト", icon: "📁" },
  { href: "/members", label: "メンバー", icon: "👥" },
];

export function AppShell({
  back,
  center,
  right,
  /** content 領域に full-height レイアウト（flex-1/min-h-0）を効かせたい場合 true。 */
  fullHeight = false,
  children,
}: {
  back?: { href: string; label: string };
  center?: React.ReactNode;
  right?: React.ReactNode;
  fullHeight?: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data } = useSession();
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () =>
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  const handleSignOut = () =>
    signOut({ fetchOptions: { onSuccess: () => router.push("/sign-in") } });

  return (
    <div className="drawer lg:drawer-open">
      <input id="app-drawer" type="checkbox" className="drawer-toggle" />

      {/* === コンテンツ側（navbar + ページ本体） === */}
      <div className="drawer-content flex min-h-svh flex-col">
        <header className="navbar sticky top-0 z-20 min-h-0 gap-2 border-b border-base-300 bg-base-100/85 px-3 py-2 backdrop-blur-md sm:px-4">
          <div className="navbar-start min-w-0 flex-1 gap-2">
            <label
              htmlFor="app-drawer"
              aria-label="メニューを開く"
              className="btn btn-square btn-ghost btn-sm lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </label>
            {back && (
              <Link
                href={back.href}
                className="shrink-0 text-sm whitespace-nowrap text-base-content/70 transition-colors hover:text-base-content"
              >
                ← {back.label}
              </Link>
            )}
            {center && <div className="min-w-0 truncate">{center}</div>}
          </div>

          <div className="navbar-end shrink-0 gap-1.5 sm:gap-2">
            {right}
            <Button
              variant="ghost"
              size="icon"
              aria-label="テーマ切替"
              onClick={toggleTheme}
            >
              <SunIcon className="h-4 w-4 scale-100 transition-transform dark:scale-0" />
              <MoonIcon className="absolute h-4 w-4 scale-0 transition-transform dark:scale-100" />
            </Button>
            {data?.user && (
              <div className="dropdown dropdown-end">
                <div
                  tabIndex={0}
                  role="button"
                  className="btn btn-ghost btn-sm max-w-[10rem]"
                >
                  <span className="hidden max-w-[8rem] truncate text-xs lg:inline">
                    {data.user.email}
                  </span>
                  <span className="lg:hidden">アカウント</span>
                </div>
                <ul
                  tabIndex={-1}
                  className="menu dropdown-content z-30 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow-lg"
                >
                  <li className="menu-title truncate">{data.user.email}</li>
                  <li>
                    <Link href="/members">メンバー</Link>
                  </li>
                  <li>
                    <button type="button" onClick={handleSignOut}>
                      サインアウト
                    </button>
                  </li>
                </ul>
              </div>
            )}
          </div>
        </header>

        <main
          className={
            fullHeight
              ? "relative flex min-h-0 flex-1 flex-col"
              : "relative flex-1"
          }
        >
          {children}
        </main>
      </div>

      {/* === サイドバー === */}
      <div className="drawer-side z-30">
        <label
          htmlFor="app-drawer"
          aria-label="メニューを閉じる"
          className="drawer-overlay"
        />
        <aside className="flex min-h-full w-60 flex-col border-r border-base-300 bg-base-200">
          <Link
            href="/studio"
            className="flex h-14 shrink-0 items-center gap-2 px-4"
          >
            <LeanQuestLogo className="h-5 w-auto text-base-content" />
            <span className="font-heading text-base font-bold tracking-tight">
              LEAN&nbsp;QUEST&nbsp;<span className="text-primary">AI</span>
            </span>
          </Link>
          <ul className="menu w-full grow gap-1 px-2">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={active ? "menu-active" : undefined}
                  >
                    <span aria-hidden>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}
