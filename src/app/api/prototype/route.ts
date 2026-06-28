import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import type { LlmProvider } from "@/lib/ai/models";
import { savePrototype } from "@/lib/projects";
import {
  realizePrototypeHtml,
  streamPrototypeHtml,
  streamUpdatePrototypeHtml,
} from "@/lib/prototype-html";
import { isS3Configured, publishHtml } from "@/lib/s3-publish";
import type { PrototypeContext } from "@/lib/v0";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body extends PrototypeContext {
  projectId?: string;
  /** 生成エンジン: "aws"=Claude生成HTML(プレビューのみ)。v0 経路は廃止。 */
  engine?: "aws";
  provider?: LlmProvider;
  modelId?: string;
  /**
   * AWS のみ:
   * - "create"（既定）: プレビュー HTML を生成（ホスティングはしない・保存のみ）
   * - "update": currentHtml に instruction を反映して作り直す（ホスティングしない）
   * - "host": 納得したプレビュー(currentHtml)を S3/CloudFront で公開して共有URLを発行
   * - "realize": プレビュー(currentHtml)を「本実装」(LQ SDKで実データ保存)版に書き換える
   * - "save": 受信完了後の HTML(currentHtml) を確定保存する（非ストリーミング・即JSON）
   */
  mode?: "create" | "update" | "host" | "realize" | "save";
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

  // 明示保存（非ストリーミング）: ストリーム受信完了後にクライアントから呼び、
  // HTML を確実に永続化する。onFinish 依存だとサーバレスでストリーム終了後に
  // savePrototype が完了しないことがあるため、ここで確定保存する。projectName は不要。
  if (body.mode === "save") {
    if (!body.projectId || typeof body.currentHtml !== "string") {
      return NextResponse.json(
        { error: "projectId と html が必要です" },
        { status: 400 },
      );
    }
    try {
      const saved = await savePrototype(user.id, body.projectId, {
        html: body.currentHtml,
      });
      if (!saved) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
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

    // 「本実装」: プレビュー HTML を LQ SDK で実データ保存・一覧する版に書き換える。
    // ストリーミングで返し、完了時に savePrototype で保存する。
    if (body.engine === "aws" && body.mode === "realize") {
      const html = body.currentHtml?.trim();
      if (!html) {
        return NextResponse.json(
          { error: "本実装するプレビューがありません" },
          { status: 400 },
        );
      }
      const result = realizePrototypeHtml(
        html,
        body.provider,
        body.modelId,
        async (out: string) => {
          if (body.projectId) {
            await savePrototype(user.id, body.projectId, { html: out });
          }
        },
      );
      return result.toTextStreamResponse();
    }

    // AWS エンジン: Claude で自己完結 HTML プレビューを生成（ホスティングはしない）。
    // ストリーミングで逐次返す（長時間でも接続が切れにくい）。完了時に保存する。
    if (body.engine === "aws") {
      const onComplete = async (html: string) => {
        if (body.projectId) {
          await savePrototype(user.id, body.projectId, { html });
        }
      };
      const result =
        body.mode === "update" && body.currentHtml?.trim()
          ? streamUpdatePrototypeHtml(
              body.currentHtml,
              body.instruction ?? "",
              body.provider,
              body.modelId,
              onComplete,
            )
          : streamPrototypeHtml(
              body,
              body.provider,
              body.modelId,
              onComplete,
            );
      return result.toTextStreamResponse();
    }

    // ここに到達するのは未対応のエンジン/モードの組み合わせ（v0 経路は廃止済み）。
    return NextResponse.json(
      { error: "Unsupported engine or mode" },
      { status: 400 },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Prototype generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
