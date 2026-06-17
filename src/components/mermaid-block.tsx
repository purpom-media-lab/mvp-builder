"use client";

/**
 * Notion の mermaid ブロック風に「図 ⇄ コード」を切り替えられる表示。
 * 図モードでは mermaid をクライアントで描画し、コードモードではソースを表示する。
 */
import { useEffect, useId, useState } from "react";

export function MermaidBlock({ code, title }: { code: string; title?: string }) {
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const rawId = useId();
  const id = `m_${rawId.replace(/[^A-Za-z0-9_]/g, "")}`;

  useEffect(() => {
    if (view !== "diagram") return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          securityLevel: "loose",
        });
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "図の描画に失敗しました");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, view, id]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可環境は無視 */
    }
  }

  function fileBase() {
    const base = (title ?? "diagram").replace(/[\\/:*?"<>|\s]+/g, "_");
    return base || "diagram";
  }

  function triggerDownload(href: string, filename: string) {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadSvg() {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${fileBase()}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function svgDimensions(): { width: number; height: number } {
    try {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      const el = doc.documentElement;
      const w = Number.parseFloat(el.getAttribute("width") ?? "");
      const h = Number.parseFloat(el.getAttribute("height") ?? "");
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return { width: w, height: h };
      }
      const vb = (el.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
        return { width: vb[2], height: vb[3] };
      }
    } catch {
      /* パース不可時は既定値 */
    }
    return { width: 1200, height: 800 };
  }

  function downloadPng() {
    if (!svg) return;
    const { width, height } = svgDimensions();
    const scale = 2; // 高解像度
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        triggerDownload(canvas.toDataURL("image/png"), `${fileBase()}.png`);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  const tab = (key: "diagram" | "code", label: string) => (
    <button
      onClick={() => setView(key)}
      className={`rounded px-2.5 py-1 text-xs font-medium ${
        view === key ? "bg-white shadow text-black" : "text-gray-500"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b bg-gray-50 px-3 py-1.5">
        <span className="text-sm font-medium text-gray-600">{title}</span>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-md bg-gray-200 p-0.5">
            {tab("diagram", "図")}
            {tab("code", "コード")}
          </div>
          {view === "diagram" && svg && !err && (
            <>
              <button
                onClick={downloadSvg}
                className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
              >
                SVG
              </button>
              <button
                onClick={downloadPng}
                className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
              >
                PNG
              </button>
            </>
          )}
          <button
            onClick={copy}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
          >
            {copied ? "コピー済" : "コピー"}
          </button>
        </div>
      </div>
      {view === "diagram" ? (
        err ? (
          <pre className="overflow-auto p-3 text-xs text-red-600">{err}</pre>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid が生成する SVG
          <div
            className="overflow-auto bg-white p-3"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )
      ) : (
        <pre className="overflow-auto bg-gray-50 p-3 text-xs leading-relaxed">
          {code}
        </pre>
      )}
    </div>
  );
}
