import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import type { LlmProvider } from "@/lib/ai/models";
import { savePrototype } from "@/lib/projects";
import {
  generatePrototypeHtml,
  updatePrototypeHtml,
} from "@/lib/prototype-html";
import { isS3Configured, publishHtml } from "@/lib/s3-publish";
import { createPrototype, type PrototypeContext } from "@/lib/v0";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body extends PrototypeContext {
  projectId?: string;
  /** 生成エンジン: "v0"=v0 Platform API / "aws"=Claude生成HTML(プレビューのみ) */
  engine?: "v0" | "aws";
  provider?: LlmProvider;
  modelId?: string;
  /** "update" のとき currentHtml に instruction を反映して作り直す（AWS のみ） */
  mode?: "create" | "update";
  instruction?: string;
  currentHtml?: string;
}

export async function POST(req: Request) {
  const user = await getSessionUser(req.headers);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.projectName?.trim()) {
    return NextResponse.json(
      { error: "projectName is required" },
      { status: 400 },
    );
  }

  try {
    // AWS エンジン: Claude で自己完結 HTML を生成。
    // S3/CloudFront 設定があれば共有 URL も発行する（無ければプレビューのみ）。
    if (body.engine === "aws") {
      const html =
        body.mode === "update" && body.currentHtml?.trim()
          ? await updatePrototypeHtml(
              body.currentHtml,
              body.instruction ?? "",
              body.provider,
              body.modelId,
            )
          : await generatePrototypeHtml(body, body.provider, body.modelId);
      // S3 公開は失敗しても生成済み HTML は返す（プレビューを失わない）。
      // 例: SSO セッション期限切れで一時的にアップロードできない場合など。
      let shareUrl: string | null = null;
      let shareError: string | null = null;
      if (isS3Configured()) {
        try {
          const key = `p/${body.projectId ?? "anon"}/${crypto.randomUUID()}/index.html`;
          shareUrl = await publishHtml(key, html);
          if (body.projectId) {
            await savePrototype(user.id, body.projectId, { demoUrl: shareUrl });
          }
        } catch (e) {
          shareError =
            e instanceof Error ? e.message : "共有URLの発行に失敗しました";
        }
      }
      return NextResponse.json({ html, shareUrl, shareError });
    }

    // v0 エンジン（既定）
    const result = await createPrototype(body);
    if (body.projectId) {
      await savePrototype(user.id, body.projectId, {
        v0ChatId: result.chatId,
        demoUrl: result.demoUrl,
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Prototype generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
