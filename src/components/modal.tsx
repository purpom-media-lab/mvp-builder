"use client";

/**
 * 画面いっぱいに近い大きなモーダル。Esc / 背景クリック / ✕ で閉じる。
 * 小さな図を大画面で見るために幅・高さを広めに取る。
 */
import { useEffect } from "react";

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** lg: 図など大画面表示 / md: フォームなど小さめ */
  size?: "lg" | "md";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={`flex flex-col rounded-lg border bg-background shadow-xl ${
          size === "lg"
            ? "h-[92vh] w-[96vw] max-w-[1600px]"
            : "max-h-[85vh] w-full max-w-xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
