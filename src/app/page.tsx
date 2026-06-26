import { Compass, Rocket, Search, TrendingUp } from "lucide-react";
import Link from "next/link";
import { LeanQuestLogo } from "@/components/leanquest-logo";

/** LEAN QUEST メソッドの 3 フェーズ（構想 → プロダクト） */
const PHASES = [
  {
    no: "01",
    icon: Search,
    title: "スコープ設計",
    desc: "体験を可視化し、やりたいこと100から最初に作る10を見出す。",
    items: ["確定スコープ", "UIデザイン", "ユースケース", "KPI", "トーンマナー"],
  },
  {
    no: "02",
    icon: Rocket,
    title: "MVP 構築",
    desc: "絞ったスコープを、動くMVPとして素早く形にする。",
    items: ["動くMVP", "ソース一式", "運用ドキュメント"],
  },
  {
    no: "03",
    icon: TrendingUp,
    title: "継続改善・伴走",
    desc: "使いながら反応を見て、次のスコープを決めていく。",
    items: ["拡張版MVP", "次アクション提案", "投資判断資料"],
  },
];

export default function Home() {
  return (
    <main className="pm-sky relative isolate min-h-screen overflow-hidden">
      <div className="pm-stars pointer-events-none absolute inset-0 -z-10" />

      <div className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-20">
        <div className="mb-7 flex items-center gap-2">
          <LeanQuestLogo className="h-6 w-auto text-base-content" />
          <span className="font-heading text-lg font-bold tracking-tight">
            LEAN&nbsp;QUEST&nbsp;<span className="text-primary">AI</span>
          </span>
        </div>
        <p className="pm-eyebrow">新規事業 — MVP スコープ設計</p>

        <h1 className="mt-5 max-w-3xl font-heading text-5xl leading-[1.08] font-extrabold tracking-tight text-balance sm:text-6xl">
          やりたいこと<span className="text-primary">100</span>を、
          <br />
          最初の<span className="text-primary">10</span>へ。
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-relaxed text-base-content/70">
          体験を可視化し、スコープを絞り、KPI とブランドまで決めて動く MVP
          に。小さく試して、確信を持って前へ。
          <span className="font-medium text-base-content">
            {" "}
            冒険の一歩目を、確かなものに。
          </span>
        </p>

        {/* signature: the 3-phase voyage */}
        <section className="mt-12 grid gap-4 sm:grid-cols-3">
          {PHASES.map((p, i) => {
            const Icon = p.icon;
            return (
              <div key={p.no} className="pm-panel relative flex flex-col gap-3 p-5">
                {i < PHASES.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 -right-3 z-10 hidden text-primary/40 sm:block"
                  >
                    ▸
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-heading text-sm font-bold text-base-content/50">
                    Phase {p.no}
                  </span>
                </div>
                <h2 className="font-heading text-lg font-bold tracking-tight">
                  {p.title}
                </h2>
                <p className="text-sm leading-relaxed text-base-content/70">
                  {p.desc}
                </p>
                <ul className="mt-auto flex flex-wrap gap-1.5 pt-1">
                  {p.items.map((it) => (
                    <li
                      key={it}
                      className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-content"
                    >
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>

        <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link
            href="/studio"
            className="group inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 font-semibold text-primary-content shadow-lg shadow-primary/25 transition-all hover:opacity-90 active:translate-y-px"
          >
            <Compass className="h-5 w-5 transition-transform duration-500 group-hover:rotate-45" />
            Studio を開く
          </Link>
          <p className="text-sm text-base-content/70">
            LLM は Claude / OpenAI / Gemini を切り替え可能
          </p>
        </div>
      </div>
    </main>
  );
}
