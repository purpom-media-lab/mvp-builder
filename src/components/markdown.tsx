import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** チャット等のAIテキストを Markdown として描画する（Tailwind でスタイル付け） */
export function Markdown({ children }: { children: string }) {
  return (
    <div
      className={[
        "space-y-2 text-sm leading-relaxed break-words",
        "[&_p]:my-0",
        "[&_strong]:font-semibold",
        "[&_em]:italic",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
        "[&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
        "[&_li]:marker:text-base-content/70",
        "[&_h1]:text-base [&_h1]:font-bold",
        "[&_h2]:text-sm [&_h2]:font-bold",
        "[&_h3]:text-sm [&_h3]:font-semibold",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8em]",
        "[&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre>code]:bg-transparent [&_pre>code]:p-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-base-300 [&_blockquote]:pl-3 [&_blockquote]:text-base-content/70",
        "[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-base-300 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-base-300 [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:my-2 [&_hr]:border-base-300",
      ].join(" ")}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
