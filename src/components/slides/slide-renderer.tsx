/**
 * slideData → HTML スライド（React）レンダラ。
 * 16:9 フレーム内に型別レイアウトを描画する。BMG の slide-viewer を参考にした
 * コアサブセット。配色はプロジェクトのブランド（theme.primary）を反映。
 */
import type { DeckTheme, SlideData } from "@/lib/slides/types";

const DEFAULT_PRIMARY = "#4F46E5";

function useAccent(theme?: DeckTheme) {
  return {
    primary: theme?.primary || DEFAULT_PRIMARY,
    accent: theme?.accent || theme?.primary || DEFAULT_PRIMARY,
  };
}

/** 16:9 のスライド外枠 */
function SlideFrame({
  children,
  pad = true,
}: {
  children: React.ReactNode;
  pad?: boolean;
}) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
      <div className={pad ? "flex h-full flex-col p-[5%]" : "h-full"}>
        {children}
      </div>
    </div>
  );
}

/** 標準ヘッダー（アクセントバー + タイトル + サブヘッド） */
function Header({
  title,
  subhead,
  primary,
}: {
  title: string;
  subhead?: string;
  primary: string;
}) {
  return (
    <div className="mb-[3%] shrink-0">
      <div className="flex items-center gap-2.5">
        <span
          className="h-6 w-1.5 rounded-full"
          style={{ backgroundColor: primary }}
        />
        <h2 className="text-2xl leading-tight font-bold tracking-tight text-slate-900">
          {title}
        </h2>
      </div>
      {subhead && (
        <p className="mt-1.5 pl-4 text-sm text-slate-500">{subhead}</p>
      )}
    </div>
  );
}

export function SlideRenderer({
  slide,
  theme,
}: {
  slide: SlideData;
  theme?: DeckTheme;
}) {
  const { primary, accent } = useAccent(theme);

  switch (slide.type) {
    case "title":
      return (
        <SlideFrame>
          <div className="flex h-full flex-col items-center justify-center text-center">
            <span
              className="mb-6 h-1.5 w-16 rounded-full"
              style={{ backgroundColor: primary }}
            />
            <h1 className="text-4xl leading-tight font-extrabold tracking-tight text-slate-900">
              {slide.title}
            </h1>
            {slide.date && (
              <p className="mt-4 text-base text-slate-400">{slide.date}</p>
            )}
          </div>
        </SlideFrame>
      );

    case "section":
      return (
        <SlideFrame pad={false}>
          <div
            className="flex h-full flex-col justify-center px-[8%] text-white"
            style={{ backgroundColor: primary }}
          >
            {slide.sectionNo != null && (
              <span className="mb-3 font-mono text-lg opacity-70">
                {String(slide.sectionNo).padStart(2, "0")}
              </span>
            )}
            <h2 className="text-4xl font-extrabold tracking-tight">
              {slide.title}
            </h2>
            {slide.subhead && (
              <p className="mt-3 text-lg opacity-80">{slide.subhead}</p>
            )}
          </div>
        </SlideFrame>
      );

    case "content":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div className="min-h-0 flex-1">
            {slide.twoColumn && slide.columns ? (
              <div className="grid h-full grid-cols-2 gap-6">
                {slide.columns.map((col, i) => (
                  <ul key={i} className="space-y-2.5">
                    {col.map((p, j) => (
                      <Bullet key={j} primary={primary}>
                        {p}
                      </Bullet>
                    ))}
                  </ul>
                ))}
              </div>
            ) : (
              <ul className="space-y-3">
                {(slide.points ?? []).map((p, i) => (
                  <Bullet key={i} primary={primary}>
                    {p}
                  </Bullet>
                ))}
              </ul>
            )}
          </div>
        </SlideFrame>
      );

    case "agenda":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <ol className="min-h-0 flex-1 space-y-2.5">
            {slide.items.map((it, i) => (
              <li key={i} className="flex items-center gap-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: primary }}
                >
                  {i + 1}
                </span>
                <span className="text-base text-slate-800">{it}</span>
              </li>
            ))}
          </ol>
        </SlideFrame>
      );

    case "cards": {
      const cols = slide.columns ?? (slide.items.length > 4 ? 3 : 2);
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div
            className="grid min-h-0 flex-1 gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {slide.items.map((it, i) => {
              const obj = typeof it === "string" ? { title: it } : it;
              return (
                <div
                  key={i}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                  style={{ borderTopColor: primary, borderTopWidth: 3 }}
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {obj.title}
                  </p>
                  {obj.desc && (
                    <p className="mt-1 text-xs text-slate-500">{obj.desc}</p>
                  )}
                </div>
              );
            })}
          </div>
        </SlideFrame>
      );
    }

    case "headerCards": {
      const cols = slide.columns ?? (slide.items.length > 4 ? 3 : 2);
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div
            className="grid min-h-0 flex-1 gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {slide.items.map((it, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-lg border border-slate-200"
              >
                <div
                  className="px-3 py-2 text-sm font-semibold text-white"
                  style={{ backgroundColor: primary }}
                >
                  {it.title}
                </div>
                {it.desc && (
                  <div className="p-3 text-xs text-slate-600">{it.desc}</div>
                )}
              </div>
            ))}
          </div>
        </SlideFrame>
      );
    }

    case "bulletCards":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div className="min-h-0 flex-1 space-y-2.5">
            {slide.items.map((it, i) => (
              <div
                key={i}
                className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
              >
                <span
                  className="mt-0.5 h-4 w-4 shrink-0 rounded-full"
                  style={{ backgroundColor: primary }}
                />
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {it.title}
                  </p>
                  <p className="text-xs text-slate-500">{it.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </SlideFrame>
      );

    case "kpi": {
      const cols = slide.columns ?? Math.min(slide.items.length, 4);
      const statusColor = (s?: string) =>
        s === "good" ? "#16a34a" : s === "bad" ? "#dc2626" : "#64748b";
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div
            className="grid min-h-0 flex-1 items-stretch gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {slide.items.map((it, i) => (
              <div
                key={i}
                className="flex flex-col justify-center rounded-lg border border-slate-200 bg-slate-50 p-4 text-center"
              >
                <p className="text-xs text-slate-500">{it.label}</p>
                <p
                  className="mt-1 text-3xl font-extrabold"
                  style={{ color: primary }}
                >
                  {it.value}
                </p>
                {it.change && (
                  <p
                    className="mt-1 text-xs font-medium"
                    style={{ color: statusColor(it.status) }}
                  >
                    {it.change}
                  </p>
                )}
              </div>
            ))}
          </div>
        </SlideFrame>
      );
    }

    case "timeline":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div className="flex min-h-0 flex-1 items-center">
            <div className="flex w-full items-start justify-between gap-2">
              {slide.milestones.map((m, i) => (
                <div
                  key={i}
                  className="relative flex flex-1 flex-col items-center text-center"
                >
                  {i < slide.milestones.length - 1 && (
                    <span className="absolute top-2 left-1/2 h-0.5 w-full bg-slate-200" />
                  )}
                  <span
                    className="relative z-10 h-4 w-4 rounded-full border-2 border-white"
                    style={{
                      backgroundColor:
                        m.state === "done"
                          ? primary
                          : m.state === "next"
                            ? accent
                            : "#cbd5e1",
                    }}
                  />
                  <span className="mt-2 text-xs font-semibold text-slate-800">
                    {m.label}
                  </span>
                  <span className="text-[0.7rem] text-slate-400">{m.date}</span>
                </div>
              ))}
            </div>
          </div>
        </SlideFrame>
      );

    case "process":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div className="flex min-h-0 flex-1 items-center gap-2">
            {slide.steps.map((s, i) => (
              <div key={i} className="flex flex-1 items-center gap-2">
                <div className="flex-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                  <span
                    className="mb-1 block font-mono text-xs font-bold"
                    style={{ color: primary }}
                  >
                    STEP {i + 1}
                  </span>
                  <span className="text-sm text-slate-800">{s}</span>
                </div>
                {i < slide.steps.length - 1 && (
                  <span style={{ color: primary }}>→</span>
                )}
              </div>
            ))}
          </div>
        </SlideFrame>
      );

    case "compare":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
            {(
              [
                { t: slide.leftTitle, items: slide.leftItems },
                { t: slide.rightTitle, items: slide.rightItems },
              ] as const
            ).map((side, i) => (
              <div
                key={i}
                className="flex flex-col overflow-hidden rounded-lg border border-slate-200"
              >
                <div
                  className="px-3 py-2 text-center text-sm font-bold text-white"
                  style={{ backgroundColor: i === 0 ? "#64748b" : primary }}
                >
                  {side.t}
                </div>
                <ul className="flex-1 space-y-2 p-3">
                  {side.items.map((it, j) => (
                    <li key={j} className="text-sm text-slate-700">
                      ・{it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </SlideFrame>
      );

    case "table":
      return (
        <SlideFrame>
          <Header title={slide.title} subhead={slide.subhead} primary={primary} />
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {slide.headers.map((h, i) => (
                    <th
                      key={i}
                      className="border-b-2 px-3 py-2 text-left font-semibold text-white"
                      style={{ backgroundColor: primary, borderColor: primary }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slide.rows.map((row, i) => (
                  <tr key={i} className={i % 2 ? "bg-slate-50" : ""}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className="border-b border-slate-200 px-3 py-1.5 text-slate-700"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SlideFrame>
      );

    case "quote":
      return (
        <SlideFrame>
          <div className="flex h-full flex-col justify-center px-[6%]">
            <span
              className="font-serif text-6xl leading-none"
              style={{ color: primary }}
            >
              &ldquo;
            </span>
            <p className="-mt-4 text-2xl leading-snug font-semibold text-slate-800">
              {slide.text}
            </p>
            {slide.author && (
              <p className="mt-4 text-sm text-slate-500">— {slide.author}</p>
            )}
          </div>
        </SlideFrame>
      );

    case "closing":
      return (
        <SlideFrame pad={false}>
          <div
            className="flex h-full flex-col items-center justify-center text-white"
            style={{ backgroundColor: primary }}
          >
            <p className="text-3xl font-bold">
              {slide.message || "ありがとうございました"}
            </p>
          </div>
        </SlideFrame>
      );

    default:
      return (
        <SlideFrame>
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            未対応のスライドタイプ
          </div>
        </SlideFrame>
      );
  }
}

function Bullet({
  children,
  primary,
}: {
  children: React.ReactNode;
  primary: string;
}) {
  return (
    <li className="flex gap-2.5">
      <span
        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: primary }}
      />
      <span className="text-base leading-snug text-slate-700">{children}</span>
    </li>
  );
}
