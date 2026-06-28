/**
 * 「本実装」MVP ホスティング（公開）。
 *
 * 保存済みプロトタイプ HTML(`prototypes.html`) に LQ ランタイム SDK の <script> を
 * 注入して text/html で返す。ビルダー自身が各 MVP をホストする共有マルチテナント構成。
 * 所有者チェックは不要（公開ホスティング）。
 */
import { buildFeedbackWidget } from "@/lib/feedback-widget";
import { buildRuntimeSdk } from "@/lib/mvp-runtime";
import { loadPrototypeHtmlPublic } from "@/lib/projects";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ projectId: string }> };

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 公開ホスティングだが内容は更新されうるのでキャッシュしない
      "cache-control": "no-store",
    },
  });
}

/** SDK の <script> を </head> 直前（無ければ </body>、それも無ければ末尾）に注入する。 */
function injectSdk(html: string, projectId: string): string {
  // ランタイム SDK（head 寄り）＋ フィードバックウィジェット（body 末尾で DOM 構築）。
  const sdkTag = `<script>\n${buildRuntimeSdk(projectId)}\n</script>`;
  const widgetTag = `<script>\n${buildFeedbackWidget(projectId)}\n</script>`;
  let out = html;
  const headClose = out.match(/<\/head>/i);
  if (headClose) {
    out = out.replace(/<\/head>/i, `${sdkTag}\n</head>`);
  } else {
    out = `${sdkTag}\n${out}`;
  }
  const bodyClose = out.match(/<\/body>/i);
  if (bodyClose) {
    return out.replace(/<\/body>/i, `${widgetTag}\n</body>`);
  }
  return `${out}\n${widgetTag}`;
}

const NOT_READY_PAGE = (message: string) => `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LEAN QUEST AI</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#0b0b0f; color:#e5e7eb; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
    .card { text-align:center; padding:2rem 2.5rem; }
    h1 { font-size:1.1rem; font-weight:600; margin:0 0 .5rem; }
    p { color:#9ca3af; font-size:.9rem; margin:0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${message}</h1>
    <p>ビルダーで「本実装」を生成すると、ここに動く MVP が表示されます。</p>
  </div>
</body>
</html>`;

export async function GET(_req: Request, { params }: Ctx) {
  const { projectId } = await params;

  const { exists, html } = await loadPrototypeHtmlPublic(projectId);
  if (!exists) {
    return htmlResponse(NOT_READY_PAGE("プロジェクトが見つかりません"), 404);
  }
  if (!html) {
    return htmlResponse(
      NOT_READY_PAGE("この MVP はまだ公開されていません"),
      200,
    );
  }
  return htmlResponse(injectSdk(html, projectId), 200);
}
