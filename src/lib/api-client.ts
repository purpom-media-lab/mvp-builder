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
    throw new Error(
      serverMsg || `生成に失敗しました（HTTP ${res.status}）。もう一度お試しください。`,
    );
  }

  return (await res.json()) as T;
}
