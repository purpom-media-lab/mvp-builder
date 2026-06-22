/**
 * プロトタイプ HTML に埋め込んだ画面マーカー（`<!-- @screen:画面名 -->`）の解析。
 *
 * 生成プロンプトが各画面の実装直前にこのコメントを出すので、
 * - 生成中: ストリーム途中のテキストから「どの画面まで生成できたか」を把握できる
 * - 生成後: 保存済み HTML から「この試作にどんな画面があるか」を一覧できる
 *
 * 依存なしの純粋関数なので、サーバ（ランナー）とクライアント（画面）の双方から使える。
 */

/** `<!-- @screen:ダッシュボード -->` を拾う。名前は前後空白を除去。 */
export const SCREEN_MARKER_RE = /<!--\s*@screen:\s*([^>]*?)\s*-->/g;

/** テキスト（生成途中でも完成HTMLでも可）から画面名を出現順・重複排除で取り出す。 */
export function parseScreenNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const m of text.matchAll(SCREEN_MARKER_RE)) {
    const name = m[1]?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}
