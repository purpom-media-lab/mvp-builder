import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createProject, listProjectsWithStats } from "@/lib/projects";
import { extractFromPdf, extractFromUrl } from "@/lib/source-extract";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await listProjectsWithStats(user.id);
  return NextResponse.json({ projects: rows });
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    name?: string;
    summary?: string;
    sourceType?: "text" | "url" | "pdf";
    sourceText?: string;
    sourceUrl?: string;
    /** PDF を base64 で受け取る（data URL プレフィックスは許容） */
    sourcePdf?: string;
  } | null;

  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const sourceType = body.sourceType ?? "text";

  // ソース種別ごとにテキストを抽出する。
  let source:
    | { type: "text" | "url" | "pdf"; title?: string; rawText: string }
    | undefined;
  try {
    if (sourceType === "url") {
      const url = body.sourceUrl?.trim();
      if (!url) {
        return NextResponse.json(
          { error: "sourceUrl is required" },
          { status: 400 },
        );
      }
      const { title, text } = await extractFromUrl(url);
      source = { type: "url", title: title ?? url, rawText: text };
    } else if (sourceType === "pdf") {
      const payload = body.sourcePdf?.trim();
      if (!payload) {
        return NextResponse.json(
          { error: "sourcePdf is required" },
          { status: 400 },
        );
      }
      // data URL の "data:...;base64," プレフィックスがあれば除去
      const base64 = payload.includes(",")
        ? payload.slice(payload.indexOf(",") + 1)
        : payload;
      // PDF.js(unpdf) は Node の Buffer を拒否するため、素の Uint8Array で渡す
      const bytes = new Uint8Array(Buffer.from(base64, "base64"));
      if (bytes.length === 0) {
        return NextResponse.json(
          { error: "sourcePdf is invalid" },
          { status: 400 },
        );
      }
      const { text } = await extractFromPdf(bytes);
      source = { type: "pdf", rawText: text };
    } else if (body.sourceText?.trim()) {
      source = { type: "text", rawText: body.sourceText };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "ソースの取り込みに失敗しました";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const project = await createProject(user.id, {
    name: body.name.trim(),
    summary: body.summary,
    source,
  });
  return NextResponse.json({ project });
}
