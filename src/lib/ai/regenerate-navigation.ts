/**
 * ナビゲーションの自動再生成（サーバ専用）。
 *
 * ナビゲーションは手動工程ではなく、モデリング（OOUI）の成果物から AI が自動導出する。
 * OOUI が生成・編集されるすべての経路（step ジョブ / save-step の手動編集）から呼ばれ、
 * 最新の OOUI を読み直してナビを生成し、navigationItems へ洗い替え保存する。
 * （一括パイプライン / orchestrate / chat は工程列に navigation を含めて生成するため対象外）
 */
import type { LlmProvider } from "./catalog";
import { jtbdSection } from "./context-sections";
import { STEP_ROLES } from "./pipeline";
import { generateNavigation } from "./steps";
import { getProjectWithArtifacts, saveStepResult } from "@/lib/projects";

export async function regenerateNavigationFromModeling(args: {
  ownerId: string;
  projectId: string;
  provider?: LlmProvider;
  modelId?: string;
}): Promise<void> {
  const a = await getProjectWithArtifacts(args.ownerId, args.projectId);
  // モデリング未生成ならナビの導出元が無いので何もしない
  if (!a || !a.ooui.length) return;

  const context = [
    `# プロジェクト: ${a.project.name}`,
    a.project.summary && `## 概要\n${a.project.summary}`,
    a.detail && `## 入力資料\n${a.detail}`,
    a.analysisResult && jtbdSection(a.analysisResult),
    a.actors.length && `## アクター\n${JSON.stringify(a.actors)}`,
    a.useCases.length && `## ユースケース\n${JSON.stringify(a.useCases)}`,
    a.ooui.length && `## OOUIオブジェクト\n${JSON.stringify(a.ooui)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const roledContext = `あなたは新規事業開発チームの「${STEP_ROLES.navigation}」です。担当領域の専門家として、最高品質で作成してください。\n\n${context}`;

  const result = await generateNavigation({
    context: roledContext,
    provider: args.provider,
    modelId: args.modelId,
  });
  await saveStepResult(args.ownerId, args.projectId, "navigation", result);
}
