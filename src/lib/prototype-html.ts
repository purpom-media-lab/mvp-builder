/**
 * Claude（など選択 LLM）で「自己完結 HTML プロトタイプ」を生成する。
 *
 * v0 の代替エンジン。OOUI パイプラインの成果物を 1 つの index.html
 * （Tailwind / React を CDN 読み込み・モックデータ内蔵・画面遷移つき）に
 * 変換する。バックエンド不要なので S3 等のホスティングなしに iframe srcDoc で
 * そのままプレビューできる。
 */
import { generateText, streamText } from "ai";
import {
  maxOutputTokensFor,
  resolveModel,
  type LlmProvider,
} from "./ai/models";
import { buildPrototypePrompt, type PrototypeContext } from "./v0";

const SYSTEM = `あなたは熟練のフロントエンドエンジニアです。与えられた要件から、クリック可能な UI プロトタイプを「単一の HTML ファイル」として出力してください。

厳守事項:
- 出力は完全な HTML ドキュメント 1 つのみ。説明文・マークダウン・コードフェンス(\`\`\`)は一切付けない。
- <!DOCTYPE html> から始め </html> で終わる。
- Tailwind CSS は CDN(<script src="https://cdn.tailwindcss.com"></script>)で読み込む。
- 画面遷移はタブ/ビュー切替で実現し、JavaScript で動作させる（ページ遷移でなく状態切替）。
- データはすべてモック（ハードコード）。外部 API は呼ばない（CDN の読み込みのみ許可）。
- 日本語 UI。実データ風のサンプルを十分に入れ、一覧→詳細→ダッシュボード等が実際にクリックで行き来できること。
- レスポンシブで、見た目は清潔でモダンに。
- 各画面（タブ/ビューで切り替わる1単位）の実装の直前に、その画面の日本語表示名を表す HTML コメントを必ず1つ置く: \`<!-- @screen:ダッシュボード -->\`。これは生成進捗の把握用マーカーでレンダリングに影響しない。ナビメニューの列挙部分やボタンには置かず、実際にその画面の中身を実装する箇所にだけ、画面ごとに1つ置くこと。`;

/** コードフェンスや前後の余計なテキストを除去して HTML 本体だけ取り出す */
function extractHtml(text: string): string {
  let t = text.trim();
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  return t.trim();
}

export async function generatePrototypeHtml(
  ctx: PrototypeContext,
  provider?: LlmProvider,
  modelId?: string,
): Promise<string> {
  const { text } = await generateText({
    model: resolveModel(provider, modelId),
    system: SYSTEM,
    prompt: buildPrototypePrompt(ctx),
    temperature: 0.6,
    maxOutputTokens: maxOutputTokensFor(),
  });
  return extractHtml(text);
}

const UPDATE_SYSTEM = `${SYSTEM}

あなたは既存の HTML プロトタイプを「修正」します。現在の HTML 全体と修正指示が与えられます。
指示を反映した上で、これまでの構成・データ・動作を可能な限り保持し、完全な HTML 全体を出力してください（差分ではなく全文）。`;

/** 直前の HTML に修正指示を反映した、更新版 HTML 全文を返す */
export async function updatePrototypeHtml(
  currentHtml: string,
  instruction: string,
  provider?: LlmProvider,
  modelId?: string,
): Promise<string> {
  const { text } = await generateText({
    model: resolveModel(provider, modelId),
    system: UPDATE_SYSTEM,
    prompt: `## 現在のHTML\n${currentHtml}\n\n## 修正指示\n${instruction}`,
    temperature: 0.5,
    maxOutputTokens: maxOutputTokensFor(),
  });
  return extractHtml(text);
}

type OnComplete = (html: string) => Promise<void> | void;

/**
 * 生成をストリーミングで返す版。逐次トークンを流すので長時間でも接続が切れにくい。
 * 完了時に onComplete(整形済みHTML) で保存などを行う。`toTextStreamResponse()` で
 * そのままレスポンス化する。
 */
export function streamPrototypeHtml(
  ctx: PrototypeContext,
  provider?: LlmProvider,
  modelId?: string,
  onComplete?: OnComplete,
) {
  return streamText({
    model: resolveModel(provider, modelId),
    system: SYSTEM,
    prompt: buildPrototypePrompt(ctx),
    temperature: 0.6,
    maxOutputTokens: maxOutputTokensFor(),
    onFinish: async ({ text }) => {
      await onComplete?.(extractHtml(text));
    },
  });
}

const REALIZE_SYSTEM = `あなたは熟練のフロントエンドエンジニアです。与えられた「プレビュー用の単一HTMLプロトタイプ」を、モックデータの代わりに実データを保存・一覧表示する「本実装」版に書き換えます。

データ層の使い方（重要）:
- データの保存・読み出し・削除は、外部から注入される LQ SDK だけを使うこと。
  - 一覧取得: window.LQ.db('コレクション名').list().then(records => ...) // records は [{id, data, createdAt}]
  - 作成:     window.LQ.db('コレクション名').create({ ...フィールド })       // 作成レコードを返す
  - 削除:     window.LQ.db('コレクション名').remove(id)
- LQ SDK は配信時にホスト側が <script> で注入する。**自分で window.LQ を定義したり、<script>でSDKを実装してはいけない**。呼び出すだけ。
- DOMContentLoaded など読み込み後に list() を呼び、取得した実データで一覧を描画する（ハードコードのモック配列は廃止）。
- フォーム送信時は create() を呼び、成功後に list() で再描画する（楽観的更新でも可）。削除ボタンは remove() を呼ぶ。
- コレクション名は画面/オブジェクトごとに分け、英数字・ハイフン・アンダースコアのみ（例: 'tasks', 'contacts'）。

認証（任意・ログインが必要なMVPのみ）:
- ログイン/サインアップが要るMVPでは、window.LQ.auth を使ってログイン画面・サインアップ画面を作る。LQ SDK が注入するので自分で実装しない（呼び出すだけ）。
  - 登録:     window.LQ.auth.signup(email, password, name).then(user => ...)
  - ログイン: window.LQ.auth.signin(email, password).then(user => ...)
  - ログアウト: window.LQ.auth.signout()
  - 現在ユーザー: window.LQ.auth.user().then(user => user ? ... : ...) // 未ログインは null
- 起動時に window.LQ.auth.user() で判定し、未認証ならログイン/サインアップ画面、認証済みならデータ画面を出す。
- ログイン後は db('コレクション').list({ mine: true }) で「そのユーザーのデータだけ」を表示できる（ownerKey はサーバがログインユーザーに紐付ける）。失敗時は例外を catch してエラー表示する。
- ログイン不要のMVPでは認証は一切使わず、従来どおり匿名で db() を使ってよい。

ファイルアップロード（任意・ファイル入力があるMVPのみ）:
- 画像/ファイルのアップロードがあるMVPでは、window.LQ.storage.upload(file).then(res => res.url) でアップロードする（file は input[type=file] の File）。
- 返った url を画像表示(src)やリンクに使い、必要なら db().create() のフィールドとして url を保存する。

厳守事項:
- 出力は完全な HTML ドキュメント 1 つのみ。説明文・マークダウン・コードフェンス(\`\`\`)は一切付けない。
- <!DOCTYPE html> から始め </html> で終わる。
- 既存の CDN 読み込み（Tailwind 等）・レイアウト・画面遷移・世界観は維持する。データの出所だけを LQ SDK に差し替える。
- 既存の画面マーカーコメント \`<!-- @screen:画面名 -->\` は各画面の実装直前にそのまま維持する（無い場合は付与する）。進捗把握用でレンダリングに影響しない。
- 非同期処理は async/await もしくは Promise で扱い、エラー時もUIが壊れないようにする。
- 日本語 UI。差分ではなく完全な HTML 全文を返す。`;

/**
 * プレビュー HTML を「本実装」（LQ SDK で実データ保存・一覧）版に書き換える（ストリーミング）。
 * 既存の作法に合わせて streamText + extractHtml。onComplete で保存する。
 */
export function realizePrototypeHtml(
  currentHtml: string,
  provider?: LlmProvider,
  modelId?: string,
  onComplete?: OnComplete,
) {
  return streamText({
    model: resolveModel(provider, modelId),
    system: REALIZE_SYSTEM,
    prompt: `## 現在のHTML（プレビュー）\n${currentHtml}\n\n上記を、LQ SDK でデータを保存・一覧表示する本実装版に書き換えて、完全なHTML全文を返してください。`,
    temperature: 0.4,
    maxOutputTokens: maxOutputTokensFor(),
    onFinish: async ({ text }) => {
      await onComplete?.(extractHtml(text));
    },
  });
}

const CONTINUE_SYSTEM = `あなたは、出力上限で途中で切れた「単一HTMLファイル」の続きだけを書きます。

厳守:
- 与えられた「現在のHTML（未完）」の **末尾の続き** だけを出力する。すでにある部分は **絶対に繰り返さない**（重複出力禁止）。
- 出力は続きの生のコードのみ。説明・マークダウン・コードフェンス(\`\`\`)・<!DOCTYPE>・<html>開始タグは付けない。
- 文書が完成するよう、必要な閉じタグ（</script> </body> </html> など）まで書き切る。特に画面遷移用の関数（navigate 等）が未定義のままなら、その定義を必ず完成させる。
- 既存の構成・命名・スタイルをそのまま引き継ぎ、自然につながるようにする。`;

/** 途中切れHTMLの「続き」だけを生成する（連結用・全文ではない）。 */
export function continuePrototypeHtml(
  currentHtml: string,
  provider?: LlmProvider,
  modelId?: string,
) {
  return streamText({
    model: resolveModel(provider, modelId),
    system: CONTINUE_SYSTEM,
    prompt: `## 現在のHTML（未完。この続きだけを書く）\n${currentHtml}`,
    temperature: 0.3,
    maxOutputTokens: maxOutputTokensFor(),
  });
}

/** 既存 HTML に修正指示を反映する版（ストリーミング）。 */
export function streamUpdatePrototypeHtml(
  currentHtml: string,
  instruction: string,
  provider?: LlmProvider,
  modelId?: string,
  onComplete?: OnComplete,
) {
  return streamText({
    model: resolveModel(provider, modelId),
    system: UPDATE_SYSTEM,
    prompt: `## 現在のHTML\n${currentHtml}\n\n## 修正指示\n${instruction}`,
    temperature: 0.5,
    maxOutputTokens: maxOutputTokensFor(),
    onFinish: async ({ text }) => {
      await onComplete?.(extractHtml(text));
    },
  });
}
