/**
 * 長時間の処理（AI生成など）を実行する間、ハートビート（空白バイト）を一定間隔で
 * 送って HTTP 接続を維持し、完了時に最終 JSON を流すレスポンスを返す。
 *
 * 目的: 単一の長いリクエストはゲートウェイ/プロキシのアイドル・タイムアウトで
 * 切断されることがある。データを流し続ける（ストリーミングのような）ことで、
 * 切断＝タイムアウトを抑制する。構造化生成（generateObject 等）でも使える。
 *
 * プロトコル: 本文は「先頭の空白（ハートビート）＋ 末尾の JSON」。
 * クライアントは全文を受け取り、trim して JSON.parse する（postJsonKeepalive）。
 * サーバ側で処理が失敗した場合は最終 JSON を `{ error }` にして 200 で流す。
 */
export function streamJsonWithHeartbeat(
  work: () => Promise<unknown>,
  opts: { heartbeatMs?: number } = {},
): Response {
  const heartbeatMs = opts.heartbeatMs ?? 12000;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // すぐ1バイト送って接続を確立（最初の反応を早める）
      controller.enqueue(enc.encode(" "));
      const hb = setInterval(() => {
        try {
          controller.enqueue(enc.encode(" "));
        } catch {
          // 既に閉じている場合は無視
        }
      }, heartbeatMs);

      try {
        const result = await work();
        clearInterval(hb);
        controller.enqueue(enc.encode("\n" + JSON.stringify(result ?? {})));
      } catch (e) {
        clearInterval(hb);
        const message = e instanceof Error ? e.message : "Generation failed";
        controller.enqueue(enc.encode("\n" + JSON.stringify({ error: message })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // プロキシのバッファリングを抑止してハートビートを確実に流す
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
