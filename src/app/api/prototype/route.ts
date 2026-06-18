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
  /**
   * AWS のみ:
   * - "create"（既定）: プレビュー HTML を生成（ホスティングはしない・保存のみ）
   * - "update": currentHtml に instruction を反映して作り直す（ホスティングしない）
   * - "host": 納得したプレビュー(currentHtml)を S3/CloudFront で公開して共有URLを発行
   */
  mode?: "create" | "update" | "host";
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
    // ホスティング（プレビューに納得した後の別アクション）:
    // 保存済み/現在の HTML を S3/CloudFront で公開し、共有 URL を発行する。
    if (body.engine === "aws" && body.mode === "host") {
      if (!isS3Configured()) {
        return NextResponse.json(
          { error: "ホスティング未設定です（S3/CloudFront の環境変数が必要）" },
          { status: 400 },
        );
      }
      const html = body.currentHtml?.trim();
      if (!html) {
        return NextResponse.json(
          { error: "ホスティングするプレビューがありません" },
          { status: 400 },
        );
      }
      const key = `p/${body.projectId ?? "anon"}/${crypto.randomUUID()}/index.html`;
      const shareUrl = await publishHtml(key, html);
      if (body.projectId) {
        await savePrototype(user.id, body.projectId, { demoUrl: shareUrl, html });
      }
      return NextResponse.json({ shareUrl, html });
    }

    // AWS エンジン: Claude で自己完結 HTML プレビューを生成（ホスティングはしない）。
    // 生成した HTML は保存し、再読込で復元できるようにする。
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
      if (body.projectId) {
        await savePrototype(user.id, body.projectId, { html });
      }
      return NextResponse.json({ html });
    }

    // v0 エンジン: 生成にホスティングが含まれる（v0 がホストする）。
    // UI 上はプレビューに納得した後にだけ実行する導線にする。
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
