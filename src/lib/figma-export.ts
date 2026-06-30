/**
 * Figma エクスポート: ExportBundle 変換（Approach B / Phase 1）
 *
 * Studio が生成したワイヤー＋ブランド＋ナビを、Figma プラグインが解釈する
 * 安定 JSON（ExportBundle）へ変換する。実体は wireframes + brand + navigation の
 * 薄い写像で、ブランドの light パレットから dark トークンを導出する。
 *
 * 設計: docs/design/figma-export.md（section→Figma マッピングは同書を真実源とする）
 * 本モジュールは DB に依存しない純関数で、入力（ExportInput）は
 * getProjectWithArtifacts の返り値が構造的に満たす。
 */

/** ブランド配色（brandDesign.palette と同形）。primary 以外は任意。 */
export interface PaletteShape {
  primary: string;
  secondary?: string;
  accent?: string;
  neutral?: string;
  background?: string;
}

/** Figma 側で塗りに使うテーマトークン（HEX）。 */
export interface ThemeTokens {
  primary: string;
  secondary: string;
  accent: string;
  neutral: string;
  base100: string; // サーフェス（カード/入力背景）
  base200: string; // 画面背景
  base300: string; // ボーダー
  content: string; // 本文テキスト
}

export type SectionType =
  | "header" | "toolbar" | "kpi" | "chart" | "table" | "list" | "cards"
  | "calendar" | "map" | "timeline" | "form" | "detail" | "sidebar"
  | "footer" | "other";

export interface ExportScreen {
  screenName: string;
  screenType: "dashboard" | "list" | "detail" | "form" | "other" | string;
  layoutPattern: "stack" | "master-detail" | "grid" | "single" | null;
  targetObject: string | null;
  sections: { type: SectionType; label: string; items: string[] | null }[];
}

export interface ExportBundle {
  meta: { projectId: string; productName: string; generatedAt: string };
  brand: {
    light: ThemeTokens;
    dark: ThemeTokens;
    /** ブランド設計の複数案（それぞれ light トークン化） */
    paletteOptions: { name: string; tokens: ThemeTokens }[];
    typography: { heading?: string; body?: string };
  };
  navigation: {
    label: string;
    targetObject: string | null;
    screenType: string;
    parent: string | null;
    icon: string | null;
  }[];
  screens: ExportScreen[];
}

/** buildExportBundle の入力（getProjectWithArtifacts の返り値が満たす構造的部分集合）。 */
export interface ExportInput {
  project: { id: string; name: string };
  brand:
    | {
        brandName?: string | null;
        palette?: PaletteShape | null;
        paletteOptions?: (PaletteShape & { name: string })[] | null;
        typography?: { heading?: string; body?: string } | null;
      }
    | null;
  navigation: {
    label: string;
    targetObject?: string | null;
    screenType?: string | null;
    parent?: string | null;
    icon?: string | null;
  }[];
  wireframes: { screenName: string; layout: unknown }[];
}

// ---- 色ユーティリティ（純粋・依存なし） ----
const FALLBACK_PRIMARY = "#6B8FA3";
const FALLBACK_NEUTRAL = "#E8E2DA";
const FALLBACK_BG = "#F7F5F2";
const LIGHT_CONTENT = "#2C3038";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "").trim();
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** a→b を t(0..1) で混色。 */
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(
    x.r + (y.r - x.r) * t,
    x.g + (y.g - x.g) * t,
    x.b + (y.b - x.b) * t,
  );
}

/** ブランドパレット → light テーマトークン。 */
export function paletteToLightTokens(p: PaletteShape | null | undefined): ThemeTokens {
  const palette = p ?? { primary: FALLBACK_PRIMARY };
  const primary = palette.primary || FALLBACK_PRIMARY;
  const neutral = palette.neutral || FALLBACK_NEUTRAL;
  const base200 = palette.background || FALLBACK_BG;
  return {
    primary,
    secondary: palette.secondary || primary,
    accent: palette.accent || primary,
    neutral,
    base100: "#FFFFFF",
    base200,
    // ボーダーは背景を本文色側へ少し寄せた淡色（淡色基調でも視認できる程度）
    base300: mix(base200, LIGHT_CONTENT, 0.12),
    content: LIGHT_CONTENT,
  };
}

/** light トークン → dark テーマトークン（ブランド色は維持、base/content を反転）。 */
export function lightToDarkTokens(light: ThemeTokens): ThemeTokens {
  return {
    primary: light.primary,
    secondary: light.secondary,
    accent: light.accent,
    neutral: light.neutral,
    base100: "#1D232A",
    base200: "#191E24",
    base300: "#2A323B",
    content: "#A6ADBB",
  };
}

/** getProjectWithArtifacts の結果 → ExportBundle。 */
export function buildExportBundle(
  a: ExportInput,
  now: string = new Date().toISOString(),
): ExportBundle {
  const light = paletteToLightTokens(a.brand?.palette ?? null);
  const dark = lightToDarkTokens(light);
  const paletteOptions = (a.brand?.paletteOptions ?? []).map((opt) => ({
    name: opt.name,
    tokens: paletteToLightTokens(opt),
  }));

  return {
    meta: {
      projectId: a.project.id,
      productName: a.brand?.brandName || a.project.name,
      generatedAt: now,
    },
    brand: {
      light,
      dark,
      paletteOptions,
      typography: a.brand?.typography ?? {},
    },
    navigation: a.navigation.map((n) => ({
      label: n.label,
      targetObject: n.targetObject ?? null,
      screenType: n.screenType ?? "other",
      parent: n.parent ?? null,
      icon: n.icon ?? null,
    })),
    screens: a.wireframes.map((w) => {
      const L = (w.layout ?? {}) as {
        screenType?: string;
        layoutPattern?: ExportScreen["layoutPattern"];
        targetObject?: string | null;
        sections?: { type: SectionType; label: string; items?: string[] | null }[];
      };
      return {
        screenName: w.screenName,
        screenType: L.screenType ?? "other",
        layoutPattern: L.layoutPattern ?? null,
        targetObject: L.targetObject ?? null,
        sections: (L.sections ?? []).map((s) => ({
          type: s.type,
          label: s.label,
          items: s.items ?? null,
        })),
      };
    }),
  };
}
