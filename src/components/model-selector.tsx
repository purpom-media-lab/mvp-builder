import type { LlmProvider } from "@/lib/ai/catalog";

/**
 * モデル選択（provider + modelId）の型。
 *
 * 旧 `ModelSelector` コンポーネント（各ページのヘッダーに置いていた provider/model
 * セレクタ）は「工程別モデル設定（ModelPrefsDialog）への一本化」により撤去した。
 * モデルの選択は ModelPrefsDialog 内の「基準モデル」と工程別設定で行う。
 * 本型は各ページ・ダイアログが共有するため、この import パスのまま残している。
 */
export interface ModelSelection {
  provider: LlmProvider;
  modelId: string;
}
