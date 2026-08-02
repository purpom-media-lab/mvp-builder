/**
 * 構造化プロトタイプ（DSエンジン）: ナビゲーション定義から「生成対象の画面」を導出する。
 *
 * 依存ゼロの純ロジック。Web アプリ（jobs-runner）と Claude Code 版パイプライン
 * （.claude/skills/mvp-pipeline/scripts/plan-screens.ts）の両方から使う。
 */

/** ナビ1項目。artifacts/navigation.json の要素と DB 由来の navigation の共通部分。 */
export interface NavItemLike {
  label: string;
  parent?: string | null;
  icon?: string | null;
  screenType?: string | null;
  targetObject?: string | null;
}

/** 生成対象の1画面。ナビ項目に加えて「どの一覧の詳細か」を持つ。 */
export interface ScreenUnit extends NavItemLike {
  /** 詳細画面のとき、対応する一覧画面のラベル。一覧・通常画面では未設定。 */
  listLabel?: string | null;
}

export interface DerivedScreens {
  /** メニュー描画に使う全項目（親子・順序つき）。画面を持たない親も含む。 */
  allNav: NavItemLike[];
  /** 生成対象の画面（リーフ + 補完した「◯◯詳細」）。 */
  units: ScreenUnit[];
  /** 詳細画面を持つ一覧画面のラベル集合。遷移指示の注入判定に使う。 */
  hasDetail: Set<string>;
}

/**
 * ナビ定義から生成対象の画面を導出する。
 *
 * - 親（＝他項目の parent になっている label）はグループ見出しとして扱い、画面を作らない。
 *   これで2階層ナビが描画でき、カテゴリ親の空画面ノイズも出ない。
 * - 一覧(list)画面には対応する「◯◯詳細」画面を補う。画面遷移図の「一覧 → 詳細」に
 *   対応する実画面で、メニュー(nav)には出さず一覧側から navigate("◯◯詳細") で遷移する。
 */
export function deriveScreenUnits(
  navigation: NavItemLike[] | null | undefined,
  projectName?: string | null,
): DerivedScreens {
  const allNav: NavItemLike[] =
    navigation && navigation.length
      ? navigation
      : [{ label: projectName || "ホーム" }];

  const parentLabels = new Set(
    allNav.map((n) => n.parent).filter((x): x is string => !!x),
  );
  const leafNav = allNav.filter((n) => !parentLabels.has(n.label));
  // 念のため: すべてが親扱いになった場合は全項目をリーフとして扱う。
  const navItems = leafNav.length ? leafNav : allNav;

  const detailUnits: ScreenUnit[] = navItems
    .filter((n) => (n.screenType ?? "").toLowerCase().includes("list"))
    .map((n) => ({
      label: `${n.label}詳細`,
      parent: null,
      icon: null,
      screenType: "detail",
      targetObject: n.targetObject ?? null,
      listLabel: n.label,
    }));

  return {
    allNav,
    units: [...navItems, ...detailUnits],
    hasDetail: new Set(
      detailUnits
        .map((d) => d.listLabel)
        .filter((x): x is string => typeof x === "string"),
    ),
  };
}
