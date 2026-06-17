/**
 * 入力ソース抽出（サーバ専用）
 *
 * URL / PDF からプレーンテキストを抽出し、パイプラインの sourceText として
 * 取り込める形に整える。クライアントからは呼ばないこと（fetch / unpdf を使う）。
 * API ルート（runtime = "nodejs"）からのみ呼び出す。
 */

/** 抽出テキストの最大長（過大なソースで後段の AI 呼び出しを膨らませない） */
const MAX_TEXT_LENGTH = 50_000;
/** URL 取得のタイムアウト（ミリ秒） */
const FETCH_TIMEOUT_MS = 15_000;

/** 連続する空白・改行を整理して読みやすいテキストにする */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/** 長すぎる場合は安全のため上限で切り詰める */
function capLength(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text;
}

/** HTML から script/style 等を除去し、タグを落として本文テキストにする */
function htmlToText(html: string): string {
  const stripped = html
    // 本文に含めたくない領域を丸ごと除去
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // ブロック境界を改行に変換して構造を残す
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // 残りのタグを除去
    .replace(/<[^>]+>/g, " ");
  // HTML エンティティの最小限のデコード
  const decoded = stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return collapseWhitespace(decoded);
}

/** HTML から <title> を抽出する（best-effort） */
function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const title = collapseWhitespace(htmlToText(m[1]));
  return title || undefined;
}

/**
 * URL を取得して本文テキストを抽出する。
 * タイムアウト付きで fetch し、HTML を読みやすいプレーンテキストへ変換する。
 */
export async function extractFromUrl(
  url: string,
): Promise<{ title?: string; text: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL の形式が正しくありません");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("http(s) の URL のみ対応しています");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(parsed, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "mvp-builder/1.0 (+source-extract)" },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("URL の取得がタイムアウトしました");
    }
    throw new Error("URL の取得に失敗しました");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`URL の取得に失敗しました (HTTP ${res.status})`);
  }

  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  // HTML 以外（プレーンテキスト等）はそのまま整形して返す
  const isHtml = contentType.includes("html") || /<html[\s>]/i.test(raw);
  const text = capLength(isHtml ? htmlToText(raw) : collapseWhitespace(raw));
  if (!text) {
    throw new Error("URL から本文を抽出できませんでした");
  }
  return { title: isHtml ? extractTitle(raw) : undefined, text };
}

/**
 * PDF のバイト列からテキストを抽出する。
 * 純 JS の unpdf を使用（ネイティブ依存なし）。
 */
export async function extractFromPdf(
  bytes: ArrayBuffer | Uint8Array,
): Promise<{ text: string }> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join("\n") : text;
  const result = capLength(collapseWhitespace(merged));
  if (!result) {
    throw new Error("PDF から本文を抽出できませんでした");
  }
  return { text: result };
}
