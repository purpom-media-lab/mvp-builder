/**
 * 構造化プロトタイプ（DSエンジン）: LLM が書いた1画面ぶんのソースを整える。
 *
 * 依存ゼロの純ロジック。Web アプリ（generate-screen）と Claude Code 版パイプライン
 * （.claude/skills/mvp-pipeline/scripts/assemble.ts）の両方から使う。
 * サニタイズは必ずコード側で行い、生成側（LLM／サブエージェント）には任せない。
 */

/** LLM 出力を関数コンポーネント1つに整える。妥当でなければ null。 */
export function sanitizeScreen(
  raw: string,
  componentName: string,
): string | null {
  let t = (raw ?? "").trim();
  // コードフェンス除去
  const fence = t.match(/```(?:jsx|tsx|js|javascript|react)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 関数名 Screen を一意名にリネーム（function / const どちらも）
  if (/function\s+Screen\b/.test(t)) {
    t = t.replace(/function\s+Screen\b/, `function ${componentName}`);
  } else if (/const\s+Screen\s*=/.test(t)) {
    t = t.replace(/const\s+Screen\s*=/, `const ${componentName} =`);
  } else {
    return null; // 期待した形でない
  }
  // 目的のコンポーネントを定義しているか
  if (!new RegExp(`(function|const)\\s+${componentName}\\b`).test(t)) return null;
  // 括弧・波括弧の釣り合い（粗いが、致命的な途中切れを弾く）
  if (!isBalanced(t)) return null;
  return t;
}

function isBalanced(s: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "}": "{", "]": "[" };
  let curly = 0,
    paren = 0,
    square = 0;
  for (const ch of s) {
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") curly++;
    else if (ch === "}") curly--;
    else if (ch === "[") square++;
    else if (ch === "]") square--;
    if (paren < 0 || curly < 0 || square < 0) return false;
    void pairs;
  }
  return paren === 0 && curly === 0 && square === 0;
}

/** 生成に失敗した画面の安全なプレースホルダ。 */
export function placeholder(componentName: string, label: string): string {
  return `function ${componentName}() {
  return (
    <Page title="${label.replace(/"/g, "")}">
      <div className="alert alert-warning">この画面はうまく生成できませんでした。「未生成だけ選択」→「プレビュー再生成」で作り直せます（他の画面は保持されます）。</div>
    </Page>
  );
}`;
}

/**
 * 保存ソースの関数名（旧 componentName）を新しい componentName に置換する。
 * componentName は英数字のみ（Screen+index）なので識別子境界で安全に置換できる。
 */
export function renameComponent(
  source: string,
  from: string,
  to: string,
): string {
  if (from === to) return source;
  return source.replace(new RegExp(`\\b${from}\\b`, "g"), to);
}
