"use client";

/**
 * 要望ヒアリング（ジョブ理論モード）ページ。
 * JTBD の枠組みで対話し、要望をプロジェクトの入力資料に反映する。
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { DEFAULT_PROVIDER, MODEL_CATALOG } from "@/lib/ai/catalog";
import { GlobalHeader } from "@/components/global-header";
import { JtbdChat } from "@/components/jtbd-chat";
import {
  type ModelSelection,
  ModelSelector,
} from "@/components/model-selector";
import { buttonVariants } from "@/components/ui/button";

export default function IntakePage() {
  const { id } = useParams<{ id: string }>();
  const [model, setModel] = useState<ModelSelection>({
    provider: DEFAULT_PROVIDER,
    modelId: MODEL_CATALOG[DEFAULT_PROVIDER].defaultModel,
  });
  const [saved, setSaved] = useState(false);

  return (
    <div className="flex h-screen flex-col">
      <GlobalHeader
        back={{ href: `/studio/${id}`, label: "分析に戻る" }}
        center={
          <span className="text-sm font-medium text-foreground">
            要望ヒアリング（ジョブ理論）
          </span>
        }
        right={
          <div className="flex items-center gap-3">
            <ModelSelector value={model} onChange={setModel} />
            {saved && (
              <Link
                href={`/studio/${id}`}
                className={buttonVariants({ size: "sm" })}
              >
                分析へ進む →
              </Link>
            )}
          </div>
        }
      />

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3 overflow-hidden p-4">
        <div>
          <p className="pm-eyebrow">jobs to be done</p>
          <h1 className="mt-2 font-heading text-xl font-bold tracking-tight">
            ジョブ理論で要望を深掘り
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            「どんな状況で、何を成し遂げたいか」を対話で整理し、入力資料に反映します。
          </p>
        </div>

        <JtbdGuide />

        {id && (
          <JtbdChat
            projectId={id}
            model={model}
            onSaved={() => setSaved(true)}
          />
        )}
      </main>
    </div>
  );
}

/**
 * 「ジョブ理論とは／なぜおすすめか」の解説セクション。
 * 折りたたみ可能（details/summary）。既存の ℹ️ ヘルプボックスとブランドに合わせる。
 */
function JtbdGuide() {
  return (
    <details className="group rounded-lg border border-primary/20 bg-primary/5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-semibold text-foreground select-none">
        <span className="shrink-0">ℹ️</span>
        <span>ジョブ理論とは？／なぜ LEAN QUEST AI でおすすめなのか</span>
        <span className="ml-auto text-xs text-muted-foreground transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="space-y-4 border-t border-primary/15 px-3 py-3 text-sm leading-relaxed text-muted-foreground">
        {/* ジョブ理論とは */}
        <div className="space-y-1.5">
          <p className="font-semibold text-foreground">ジョブ理論（JTBD）とは</p>
          <p>
            人は製品を「買う」のではなく、ある
            <span className="font-medium text-foreground">状況</span>で
            <span className="font-medium text-foreground">進歩（プログレス）</span>
            を遂げるために、製品を「
            <span className="font-medium text-foreground">雇用（hire）</span>
            」する——という考え方です。だから「機能」ではなく、ユーザーの
            <span className="font-medium text-foreground">
              状況・動機・期待する成果（ジョブ）
            </span>
            でプロダクトを捉えます。
          </p>
          <p>
            有名な比喩が「
            <span className="font-medium text-foreground">
              人は4分の1インチのドリルが欲しいのではなく、4分の1インチの穴が欲しい
            </span>
            」。買いたいのはドリル（機能）ではなく、空けたい穴（成し遂げたい進歩）の方だ、という話です。
          </p>
          <p>
            人を動かす
            <span className="font-medium text-foreground">力学</span>
            にも目を向けます。前に進める
            <span className="font-medium text-foreground">推進力</span>
            （現状への不満／よりよい未来への引力）と、それを妨げる
            <span className="font-medium text-foreground">抵抗力</span>
            （乗り換えの不安／いまのやり方への惰性）。この綱引きを理解すると、本当に効く一手が見えてきます。
          </p>
        </div>

        {/* なぜおすすめか */}
        <div className="space-y-1.5">
          <p className="font-semibold text-foreground">
            なぜ LEAN QUEST AI でジョブ理論をおすすめするのか
          </p>
          <ul className="space-y-1.5">
            <li className="flex gap-2">
              <span className="shrink-0 text-primary">●</span>
              <span>
                機能起点だと「あれもこれも」でスコープが膨らみがち。
                <span className="font-medium text-foreground">
                  ジョブ起点なら「どの進歩を助けるか」で機能を取捨選択できる
                </span>
                ので、
                <span className="font-medium text-foreground">
                  やりたいこと100を、最初の10へ
                </span>
                絞り込む判断に直結します。
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 text-primary">●</span>
              <span>
                ユーザーの本当の動機と成功基準が言語化されるので、
                <span className="font-medium text-foreground">
                  MVPの仮説とKPIが立てやすく
                </span>
                なります。
              </span>
            </li>
            <li className="flex gap-2">
              <span className="shrink-0 text-primary">●</span>
              <span>
                状況・ジョブ・力学が整理されることで、続く
                <span className="font-medium text-foreground">
                  アクター／ユースケース／ジャーニー分析の入力品質が上がり
                </span>
                、この後の工程がスムーズに進みます。
              </span>
            </li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground/80">
          下のチャットでは、状況 → 成し遂げたい進歩 → 既存の代替と不満 → 力学 → 成功基準の順に、AIが1問ずつ深掘りします。
        </p>
      </div>
    </details>
  );
}
