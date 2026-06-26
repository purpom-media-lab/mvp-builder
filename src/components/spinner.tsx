import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** 回転スピナー */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("animate-spin", className)} aria-hidden />;
}

/** 領域いっぱいのローディング表示 */
export function PageLoading({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-3 text-base-content/70">
      <Spinner className="h-6 w-6 text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** 半透明オーバーレイのローディング（初回読み込み中に画面を覆う） */
export function LoadingOverlay({ label = "読み込み中…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-base-200/70 text-base-content/70 backdrop-blur-sm">
      <Spinner className="h-6 w-6 text-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
