import Link from "next/link";

const PIPELINE = [
  "資料読込",
  "アクター整理",
  "ユースケース",
  "OOUI分析",
  "ジャーニー",
  "ワイヤー",
  "データ設計",
  "バックエンド要否判定",
  "プロトタイプ生成（v0）",
  "公開・引き継ぎ",
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-16">
      <h1 className="text-4xl font-bold tracking-tight">MVP Builder</h1>
      <p className="mt-4 text-lg text-gray-600">
        事業アイデア/要件を入力すると、OOUI 分析から動く MVP
        プロトタイプの生成・公開までを一気通貫で行います。
      </p>

      <ol className="mt-8 flex flex-wrap gap-2">
        {PIPELINE.map((step, i) => (
          <li
            key={step}
            className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700"
          >
            {i + 1}. {step}
          </li>
        ))}
      </ol>

      <div className="mt-10">
        <Link
          href="/studio"
          className="inline-block rounded-md bg-black px-6 py-3 font-semibold text-white hover:bg-gray-800"
        >
          Studio を開く →
        </Link>
      </div>

      <p className="mt-6 text-sm text-gray-500">
        LLM は Claude / OpenAI / Gemini を切り替え可能。
      </p>
    </main>
  );
}
