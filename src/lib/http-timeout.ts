/**
 * undici（Node の fetch 実装）のタイムアウトを無効化する。
 *
 * v0 のプロトタイプ生成は responseMode: "sync" で生成完了まで HTTP 応答を
 * 保持し続ける。重い仕様だと生成が undici の既定 300 秒（headersTimeout /
 * bodyTimeout）を超え、UND_ERR_HEADERS_TIMEOUT で 500 になる。
 * 長時間の生成リクエストを通すため、グローバルディスパッチャの該当タイムアウトを
 * 0（無効）にする。サーバー側でのみ import すること。
 */
import { setGlobalDispatcher, Agent } from "undici";

setGlobalDispatcher(
  new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 0 }),
);
