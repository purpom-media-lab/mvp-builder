/**
 * slideData の TypeScript 型定義（gslide-data-gen / figma-slide-gen 互換）。
 * 提案資料を構成するスライドの判別ユニオン。BMG の slide-viewer を参考にした
 * コアサブセット（14 型）。
 */

type SlideBase = { notes?: string };

export type TitleSlide = SlideBase & {
  type: "title";
  title: string;
  date?: string;
};

export type SectionSlide = SlideBase & {
  type: "section";
  title: string;
  subhead?: string;
  sectionNo?: number;
};

export type ContentSlide = SlideBase & {
  type: "content";
  title: string;
  subhead?: string;
  points?: string[];
  twoColumn?: boolean;
  columns?: [string[], string[]];
};

export type AgendaSlide = SlideBase & {
  type: "agenda";
  title: string;
  subhead?: string;
  items: string[];
};

export type CardItem = string | { title: string; desc?: string };
export type CardsSlide = SlideBase & {
  type: "cards";
  title: string;
  subhead?: string;
  columns?: 2 | 3;
  items: CardItem[];
};

export type HeaderCardsSlide = SlideBase & {
  type: "headerCards";
  title: string;
  subhead?: string;
  columns?: 2 | 3;
  items: { title: string; desc?: string }[];
};

export type BulletCardsSlide = SlideBase & {
  type: "bulletCards";
  title: string;
  subhead?: string;
  items: { title: string; desc: string }[];
};

export type KpiSlide = SlideBase & {
  type: "kpi";
  title: string;
  subhead?: string;
  columns?: 2 | 3 | 4;
  items: {
    label: string;
    value: string;
    change?: string;
    status?: "good" | "bad" | "neutral";
  }[];
};

export type TimelineSlide = SlideBase & {
  type: "timeline";
  title: string;
  subhead?: string;
  milestones: {
    label: string;
    date: string;
    state?: "done" | "next" | "todo";
  }[];
};

export type ProcessSlide = SlideBase & {
  type: "process";
  title: string;
  subhead?: string;
  steps: string[];
};

export type CompareSlide = SlideBase & {
  type: "compare";
  title: string;
  subhead?: string;
  leftTitle: string;
  rightTitle: string;
  leftItems: string[];
  rightItems: string[];
};

export type TableSlide = SlideBase & {
  type: "table";
  title: string;
  subhead?: string;
  headers: string[];
  rows: string[][];
};

export type QuoteSlide = SlideBase & {
  type: "quote";
  title?: string;
  text: string;
  author?: string;
};

export type ClosingSlide = SlideBase & {
  type: "closing";
  message?: string;
};

export type SlideData =
  | TitleSlide
  | SectionSlide
  | ContentSlide
  | AgendaSlide
  | CardsSlide
  | HeaderCardsSlide
  | BulletCardsSlide
  | KpiSlide
  | TimelineSlide
  | ProcessSlide
  | CompareSlide
  | TableSlide
  | QuoteSlide
  | ClosingSlide;

export type SlideType = SlideData["type"];

/** 資料全体のブランド配色（プロジェクトのブランド設計から流し込む） */
export type DeckTheme = {
  primary?: string;
  accent?: string;
};
