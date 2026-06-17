/**
 * 公開ステージ（GitHub / Vercel 引き継ぎ）— サーバ専用
 *
 * SCAFFOLD ONLY: 実際の GitHub リポジトリ作成や Vercel デプロイは行わない。
 * トークン（GITHUB_TOKEN / VERCEL_TOKEN）が未設定の場合は副作用なしで
 * "not-configured" を返す。実装を差し込む箇所には TODO(handoff) を残す。
 *
 * NOTE: process.env.*_TOKEN を参照するためサーバ専用。クライアントから import しないこと。
 */

export type HandoffStatus = "published" | "not-configured" | "failed";

export type HandoffResult = {
  githubRepoUrl: string | null;
  deploymentUrl: string | null;
  status: HandoffStatus;
  message: string;
};

export type PublishProjectArgs = {
  projectName: string;
  html?: string | null;
  demoUrl?: string | null;
};

/** GitHub 連携が設定済みか（トークンの有無で判定） */
export function isGithubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

/** Vercel 連携が設定済みか（トークンの有無で判定） */
export function isVercelConfigured(): boolean {
  return !!process.env.VERCEL_TOKEN;
}

/**
 * プロジェクトを GitHub / Vercel に引き継ぐ。
 *
 * SCAFFOLD ONLY: トークンが揃っていてもネットワーク呼び出しは行わず、
 * 実装は TODO(handoff) として残してある。
 */
export async function publishProject(
  args: PublishProjectArgs,
): Promise<HandoffResult> {
  const notConfigured: HandoffResult = {
    githubRepoUrl: null,
    deploymentUrl: null,
    status: "not-configured",
    message:
      "GITHUB_TOKEN / VERCEL_TOKEN が未設定のため、引き継ぎはスキップされました。",
  };

  if (!isGithubConfigured() || !isVercelConfigured()) {
    return notConfigured;
  }

  // TODO(handoff): GitHub リポジトリ作成 + push、Vercel デプロイをここで実装
  //   - args.projectName からリポジトリ名を生成
  //   - args.html / args.demoUrl を初期コンテンツとして push
  //   - 成功時は { status: "published", githubRepoUrl, deploymentUrl, message } を返す
  //   - 失敗時は { status: "failed", ... } を返す
  // 実装が入るまでは副作用なしで not-configured 相当を返す。
  void args;
  return notConfigured;
}
