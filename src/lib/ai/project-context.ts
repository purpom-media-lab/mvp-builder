/**
 * プロジェクト成果物 → 各種生成のコンテキスト文字列を組み立てる共有ヘルパー。
 *
 * 提案資料(deck)・デザイナー依頼ブリーフ・エンジニア依頼ブリーフの文脈生成を一元化し、
 * API ルート（同期）とジョブランナー（非同期 after()）の双方から使う。
 */
import type { getProjectWithArtifacts } from "@/lib/projects";
import type { PrototypeContext } from "@/lib/v0";

export type ProjectArtifacts = NonNullable<
  Awaited<ReturnType<typeof getProjectWithArtifacts>>
>;

/** 分析成果物 → プロトタイプ生成コンテキスト（プロトタイプ画面と同じ写像）。
 *  デザイナー成果物リファイン用に refineReference を注入する。 */
export function buildRefinePrototypeContext(
  a: ProjectArtifacts,
  refineReference: PrototypeContext["refineReference"],
): PrototypeContext {
  return {
    projectName: a.project.name,
    summary: a.project.summary,
    actors: a.actors.map((x) => ({ name: x.name, description: x.description })),
    useCases: a.useCases.map((x) => ({
      goal: x.goal,
      description: x.description,
    })),
    oouiObjects: a.ooui.map((o) => ({
      name: o.name,
      attributes: (o.attributes ?? []).map((at) => at.label ?? at.name),
    })),
    navigation: a.navigation.map((n) => ({
      label: n.label,
      targetObject: n.targetObject,
      screenType: n.screenType,
      parent: n.parent,
      icon: n.icon,
    })),
    mvpStatement: a.mvpStatement,
    scope: a.scope
      .filter((f) => f.includedInMvp)
      .map((f) => ({ name: f.name, description: f.description })),
    kpis: [a.kpi.northStar, ...a.kpi.supporting]
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map((m) => ({ name: m.name, target: m.target })),
    brand: a.brand
      ? {
          brandName: a.brand.brandName,
          tagline: a.brand.tagline,
          tone: a.brand.tone,
          palette: a.brand.palette,
          typography: a.brand.typography,
          logoDirection: a.brand.logoDirection,
        }
      : null,
    refineReference,
  };
}

/** 提案資料(deck)生成用のコンテキスト */
export function buildDeckContext(p: ProjectArtifacts): string {
  const mvpScope = p.scope.filter((s) => s.includedInMvp);
  return [
    `# プロジェクト: ${p.project.name}`,
    p.project.summary && `## 概要\n${p.project.summary}`,
    p.mvpStatement && `## MVPの仮説・提供価値\n${p.mvpStatement}`,
    p.sourceText && `## 入力資料(抜粋)\n${p.sourceText.slice(0, 2000)}`,
    p.actors.length && `## アクター\n${JSON.stringify(p.actors)}`,
    p.useCases.length && `## ユースケース\n${JSON.stringify(p.useCases)}`,
    mvpScope.length &&
      `## MVPに含む機能(確定スコープ)\n${JSON.stringify(
        mvpScope.map((s) => ({
          name: s.name,
          description: s.description,
          impact: s.impact,
          effort: s.effort,
        })),
      )}`,
    (p.kpi.northStar || p.kpi.supporting.length) &&
      `## KPI\n${JSON.stringify({
        northStar: p.kpi.northStar,
        supporting: p.kpi.supporting,
      })}`,
    p.growthPlan && `## グロース計画\n${JSON.stringify(p.growthPlan)}`,
    p.brand && `## ブランド\n${JSON.stringify(p.brand)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** デザイナー依頼ブリーフ生成用のコンテキスト（プロトタイプの有無を含む） */
export function buildDesignBriefContext(a: ProjectArtifacts): string {
  return [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    a.ooui.length && `## OOUIオブジェクト\n${JSON.stringify(a.ooui)}`,
    a.navigation.length && `## ナビゲーション\n${JSON.stringify(a.navigation)}`,
    a.wireframes.length &&
      `## ワイヤーフレーム\n${JSON.stringify(a.wireframes)}`,
    a.scope.length && `## スコープ\n${JSON.stringify(a.scope)}`,
    a.mvpStatement && `## MVPステートメント\n${a.mvpStatement}`,
    a.brand && `## ブランド設計\n${JSON.stringify(a.brand)}`,
    `## プロトタイプ\n${a.prototype ? "クリック可能なプロトタイプが生成済み（このUIをデザイナーがブラッシュアップする前提）" : "プロトタイプ未生成"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** エンジニア依頼ブリーフ生成用のコンテキスト（実装に必要な設計情報を厚めに含める） */
export function buildEngineerBriefContext(a: ProjectArtifacts): string {
  const mvpScope = a.scope.filter((f) => f.includedInMvp);
  return [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.mvpStatement && `## MVPステートメント\n${a.mvpStatement}`,
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    (mvpScope.length ? mvpScope : a.scope).length &&
      `## スコープ（MVPに含む機能を優先）\n${JSON.stringify(
        mvpScope.length ? mvpScope : a.scope,
      )}`,
    a.navigation.length && `## ナビゲーション\n${JSON.stringify(a.navigation)}`,
    a.wireframes.length &&
      `## ワイヤーフレーム\n${JSON.stringify(a.wireframes)}`,
    a.dataModel.length && `## データ設計\n${JSON.stringify(a.dataModel)}`,
    a.backend && `## バックエンド要否判定\n${JSON.stringify(a.backend)}`,
    (a.kpi.northStar || a.kpi.supporting.length) &&
      `## KPI\n${JSON.stringify(a.kpi)}`,
    `## プロトタイプ\n${a.prototype ? "クリック可能なプロトタイプが生成済み（このUIをエンジニアが実装する前提）" : "プロトタイプ未生成"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
