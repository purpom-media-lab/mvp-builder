/**
 * クライアント用の POST ヘルパー。
 * - AbortController でクライアント側タイムアウトを設ける（既定で永遠に待つのを防ぐ）
 * - タイムアウト / 504 / 非JSON応答でも、ユーザーに分かりやすい日本語メッセージを投げる
 *
 * 既定タイムアウトはサーバの maxDuration(300s) より少し長い 310 秒。
 * これを超えたらクライアント側で打ち切ってエラー表示する。
 */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 310_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        "生成がタイムアウトしました。時間をおいて、もう一度お試しください。",
      );
    }
    throw new Error(
      "通信エラーが発生しました。接続を確認して、もう一度お試しください。",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // エラー本文が JSON とは限らない（504 のゲートウェイ HTML 等）
    let serverMsg = "";
    try {
      const d = (await res.json()) as { error?: string };
      serverMsg = d?.error ?? "";
    } catch {
      // 非JSON は無視してステータスから判断
    }
    if (res.status === 504 || res.status === 408 || res.status === 524) {
      throw new Error(
        serverMsg ||
          "生成がタイムアウトしました（サーバ側の上限超過）。もう一度お試しください。",
      );
    }
    // Vercel の関数ボディ上限（4.5MB）超過。本文はプレーンテキストで返る。
    if (res.status === 413) {
      throw new Error(
        serverMsg ||
          "送信データが大きすぎます（サーバの上限を超過）。PDF などの添付は約3MB以下にしてください。",
      );
    }
    throw new Error(
      serverMsg || `生成に失敗しました（HTTP ${res.status}）。もう一度お試しください。`,
    );
  }

  return (await res.json()) as T;
}

/**
 * text/plain のストリーミング応答を読み、チャンク到着ごとに onChunk(累積, 差分) を
 * 呼びつつ全文を返す。逐次データが流れるので長時間生成でも接続が切れにくく、
 * 進捗を表示できる。タイムアウト/エラーは postJson と同じ方針で投げる。
 */
export async function streamPost(
  url: string,
  body: unknown,
  opts: {
    timeoutMs?: number;
    onChunk?: (acc: string, delta: string) => void;
  } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 310_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        "生成がタイムアウトしました。時間をおいて、もう一度お試しください。",
      );
    }
    throw new Error(
      "通信エラーが発生しました。接続を確認して、もう一度お試しください。",
    );
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    let serverMsg = "";
    try {
      const d = (await res.json()) as { error?: string };
      serverMsg = d?.error ?? "";
    } catch {
      // 非JSON
    }
    throw new Error(
      serverMsg || `生成に失敗しました（HTTP ${res.status}）。もう一度お試しください。`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const delta = decoder.decode(value, { stream: true });
      acc += delta;
      opts.onChunk?.(acc, delta);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        "生成がタイムアウトしました。時間をおいて、もう一度お試しください。",
      );
    }
    throw new Error("通信が途中で切断されました。もう一度お試しください。");
  } finally {
    clearTimeout(timer);
  }
  return acc;
}

/**
 * ハートビート・キープアライブ応答（streamJsonWithHeartbeat）を受け取り、
 * 先頭の空白を捨てて最終 JSON を返す。接続が維持されるのでタイムアウトしにくい。
 * サーバ側が `{ error }` を返した場合はそれを投げる（postJson と同じ使い心地）。
 */
export async function postJsonKeepalive<T = unknown>(
  url: string,
  body: unknown,
  opts: { timeoutMs?: number; onPing?: () => void } = {},
): Promise<T> {
  const raw = await streamPost(url, body, {
    timeoutMs: opts.timeoutMs,
    onChunk: () => opts.onPing?.(),
  });
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("生成に失敗しました（空の応答）。もう一度お試しください。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("生成結果の解析に失敗しました。もう一度お試しください。");
  }
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const msg = String((parsed as { error: unknown }).error);
    throw new Error(msg || "生成に失敗しました。もう一度お試しください。");
  }
  return parsed as T;
}

/** モデル出力（コードフェンス等が混ざる場合あり）から HTML 本体だけ取り出す */
export function extractHtmlFromText(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  return t.trim();
}
