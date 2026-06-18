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
