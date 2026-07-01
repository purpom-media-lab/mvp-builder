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
  /**
   * status==="published" のとき、アクセス保護（Deployment Protection）を解除できたか。
   * false = 保護が残っており公開URLは Vercel ログインが必要（UI で手動解除を案内する）。
   * OAuth 連携トークンは保護設定を変更できないため、保護 ON のチームでは false になる。
   */
  protectionDisabled?: boolean;
};

/** 公開に使う Vercel 認証情報（per-user OAuth トークン or 共有トークン）。 */
export type VercelCreds = { token: string; teamId: string | null };

export type PublishProjectArgs = {
  projectName: string;
  html?: string | null;
  demoUrl?: string | null;
  /**
   * 公開先の Vercel 認証情報。指定があればそのユーザーの Vercel に公開する。
   * 未指定なら共有の VERCEL_TOKEN（env）にフォールバックする。
   */
  vercel?: VercelCreds | null;
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

const VERCEL_API = "https://api.vercel.com";
function teamQs(teamId: string | null): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

/**
 * 公開に使う認証情報を解決する。
 * 1. 引数で per-user トークンが渡されていればそれを使う（＝ユーザー所有アカウント）。
 * 2. 無ければ共有の VERCEL_TOKEN（env）にフォールバック。
 * 3. どちらも無ければ null（未設定）。
 */
function resolveCreds(injected?: VercelCreds | null): VercelCreds | null {
  if (injected?.token) return injected;
  const token = process.env.VERCEL_TOKEN;
  if (token) return { token, teamId: process.env.VERCEL_TEAM_ID ?? null };
  return null;
}

/**
 * 単一の HTML を Vercel に **preview** デプロイし、公開URLと projectId を返す。
 * production ではなく preview（一意URL）にして、誤って本番を上書きしないようにする。
 */
async function deployStaticHtmlToVercel(
  projectName: string,
  html: string,
  creds: VercelCreds,
): Promise<{ url: string; projectId: string | null }> {
  const res = await fetch(`${VERCEL_API}/v13/deployments${teamQs(creds.teamId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.token}`,
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
    projectId?: string;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(
      data?.error?.message ?? `Vercel デプロイに失敗しました (HTTP ${res.status})`,
    );
  }
  const url = data?.url;
  if (!url) throw new Error("Vercel からデプロイ URL が返りませんでした");
  return {
    url: url.startsWith("http") ? url : `https://${url}`,
    projectId: data?.projectId ?? null,
  };
}

/**
 * 公開MVPを誰でも閲覧できるよう、当該プロジェクトの Deployment Protection
 * （Vercel Authentication）をオフにする。チーム既定で保護されているため、
 * 書き出した MVP プロジェクト単位で解除する（他プロジェクトには影響しない）。
 * 組織ポリシーで解除不可の場合はエラーになる（呼び出し側で best-effort 扱い）。
 */
async function disableDeploymentProtection(
  projectIdOrName: string,
  creds: VercelCreds,
): Promise<void> {
  const res = await fetch(
    `${VERCEL_API}/v9/projects/${encodeURIComponent(projectIdOrName)}${teamQs(creds.teamId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      // ssoProtection=null で Vercel Authentication を無効化（＝公開）
      body: JSON.stringify({ ssoProtection: null }),
    },
  );
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      d?.error?.message ?? `保護解除に失敗しました (HTTP ${res.status})`,
    );
  }
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
  const creds = resolveCreds(args.vercel);
  if (!creds) {
    return {
      githubRepoUrl: null,
      deploymentUrl: null,
      status: "not-configured",
      message:
        "Vercel が未連携です。先に「Vercel を連携」してから公開してください（または共有 VERCEL_TOKEN を .env.local に設定）。",
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
    const { url, projectId } = await deployStaticHtmlToVercel(
      args.projectName,
      html,
      creds,
    );
    // チーム既定の Deployment Protection を、この MVP プロジェクトだけ解除して公開化。
    // 解除できない場合（組織ポリシー / OAuth トークンの権限不足等）はデプロイ自体は成功
    // なので、保護が残っている旨を構造化フラグ + メッセージで返す（UI で手動解除を案内）。
    let protectionDisabled = true;
    let note = "";
    try {
      await disableDeploymentProtection(
        projectId ?? toVercelProjectName(args.projectName),
        creds,
      );
    } catch (e) {
      protectionDisabled = false;
      note =
        "（注意: アクセス保護を自動解除できませんでした。URL は Vercel ログインが必要なままです。Team Settings → Deployment Protection をご確認ください）" +
        (e instanceof Error ? ` [${e.message}]` : "");
    }
    return {
      githubRepoUrl: null,
      deploymentUrl: url,
      status: "published",
      message: "Vercel に公開しました。" + note,
      protectionDisabled,
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
