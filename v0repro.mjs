import { createClient } from "v0-sdk";
const v0 = createClient({ apiKey: process.env.V0_API_KEY });
// アプリの buildPrototypePrompt 相当（OOUIオブジェクト多数の重いプロンプト）
const msg = `次のアプリの「クリック可能なUIプロトタイプ」を Next.js で作ってください。モックデータで画面遷移できること。

## アプリ概要
- AIセールスリード・オートパイロット：営業リードの取り込み・評価・振り分け・追客・分析をAIが自動で回す

## アクター
- 営業担当：割り当てられたリードに対応
- 営業マネージャー：パイプライン管理・売上予測
- マーケティング担当：流入元管理・ナーチャリング設計
- AIエージェント：スコアリング・振り分け・フォロー文生成

## 主要ユースケース
1. リード自動取り込み（フォーム/名刺/メール/Web行動から名寄せ登録）
2. AIスコアリング（属性+行動で確度算出, ホット/ウォーム/コールド）
3. 自動振り分け（エリア/業種/負荷で担当アサイン）
4. 次アクション提案（いつ誰に何を）
5. フォロー自動化（メール下書き/自動送信）
6. 活動ログ自動記録（メール/通話/商談メモ要約）
7. ホットリード通知
8. 失注予測アラート
9. パイプライン分析（滞留/転換率/売上予測）
10. AIへの自然言語問い合わせ

## 主要オブジェクト（画面/データの単位）
- リード（会社名, 担当者名, スコア, ステータス, 流入元, 最終接触日）
- 活動ログ（種別, 日時, 要約, 担当）
- 営業担当（氏名, 担当エリア, 負荷）
- フォロー施策（トリガー, 文面テンプレ, 送信状況）
- ダッシュボード（パイプライン段階, 転換率, 売上予測）
- 通知（種別, 対象リード, 緊急度）`;
const t0 = Date.now();
const chat = await v0.chats.create({ message: msg, responseMode: "async" });
console.log("created id:", chat.id);
console.log("webUrl:", chat.webUrl);
console.log("init latestVersion:", JSON.stringify(chat.latestVersion ?? null));
let demoUrl = chat.latestVersion?.demoUrl ?? null;
let status = chat.latestVersion?.status;
const deadline = Date.now() + 6*60*1000;
while (!demoUrl && status !== "failed" && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 4000));
  try {
    const d = await v0.chats.getById({ chatId: chat.id });
    demoUrl = d.latestVersion?.demoUrl ?? null;
    status = d.latestVersion?.status;
    console.log(`  +${((Date.now()-t0)/1000).toFixed(0)}s status=${status} demo=${demoUrl?"YES":"no"}`);
  } catch (e) {
    console.log(`  +${((Date.now()-t0)/1000).toFixed(0)}s ERR ${e?.message?.slice(0,80)}`);
  }
}
console.log("FINAL in", ((Date.now()-t0)/1000).toFixed(1), "s | status:", status, "| demoUrl:", demoUrl);
