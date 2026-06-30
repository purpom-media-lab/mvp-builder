/**
 * 公開ステージ（Vercel への公開）— サーバ専用
 *
 * 生成したプロトタイプ HTML を Vercel に **インラインデプロイ**して公開URLを返す。
 * GitHub もビルドも不要で、必要なのは長期有効な `VERCEL_TOKEN`（と任意で
 * `VERCEL_TEAM_ID`）だけ。AWS SSO のような期限切れが無く、S3/CloudFront 方式より簡単。
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

/** GitHub 連携が設定済みか（トークンの有無で判定。現状は未使用＝Vercel 単体公開） */
export function isGithubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

/** Vercel 連携が設定済みか（トークンの有無で判定） */
export function isVercelConfigured(): boolean {
  return !!process.env.VERCEL_TOKEN;
}

/** Vercel プロジェクト名に使える slug へ変換（a-z0-9 とハイフン、最大 ~52 文字）。 */
function toVercelProjectName(name: string): string {
  const slug = (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return slug || "lean-quest-mvp";
}

/**
 * 単一の HTML を Vercel に **preview** デプロイし、公開URL（`https://xxxx.vercel.app`）を返す。
 * production ではなく preview（一意URL）にして、誤って本番を上書きしないようにする。
 */
async function deployStaticHtmlToVercel(
  projectName: string,
  html: string,
): Promise<string> {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token) throw new Error("VERCEL_TOKEN が未設定です");

  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const res = await fetch(`https://api.vercel.com/v13/deployments${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: toVercelProjectName(projectName),
      files: [{ file: "index.html", data: html }],
      projectSettings: { framework: null },
      // target を指定しない = preview デプロイ（一意の *.vercel.app URL）
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data?.error?.message ?? `Vercel デプロイに失敗しました (HTTP ${res.status})`,
    );
  }
  const url = data?.url;
  if (!url) throw new Error("Vercel からデプロイ URL が返りませんでした");
  return url.startsWith("http") ? url : `https://${url}`;
}

/**
 * プロジェクト（プロトタイプ HTML）を Vercel に公開する。
 * - VERCEL_TOKEN 未設定 → not-configured（副作用なし）
 * - HTML 無し → failed（先に生成・保存が必要）
 * - 成功 → published（deploymentUrl に *.vercel.app）
 */
export async function publishProject(
  args: PublishProjectArgs,
): Promise<HandoffResult> {
  if (!isVercelConfigured()) {
    return {
      githubRepoUrl: null,
      deploymentUrl: null,
      status: "not-configured",
      message:
        "VERCEL_TOKEN が未設定のため、Vercel 公開はスキップされました（.env.local に設定してください）。",
    };
  }

  const html = args.html?.trim();
  if (!html) {
    return {
      githubRepoUrl: null,
      deploymentUrl: null,
      status: "failed",
      message:
        "公開するプレビュー HTML がありません。先にプロトタイプを生成・保存してください。",
    };
  }

  try {
    const deploymentUrl = await deployStaticHtmlToVercel(args.projectName, html);
    return {
      githubRepoUrl: null,
      deploymentUrl,
      status: "published",
      message: "Vercel に公開しました。",
    };
  } catch (e) {
    return {
      githubRepoUrl: null,
      deploymentUrl: null,
      status: "failed",
      message: e instanceof Error ? e.message : "Vercel 公開に失敗しました",
    };
  }
}
