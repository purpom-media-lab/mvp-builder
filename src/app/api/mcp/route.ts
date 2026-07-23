/**
 * MCP サーバー（Streamable HTTP / ステートレス）。
 *
 * Claude Code などの MCP クライアントから、プロジェクトの分析・設計成果物を
 * 読み取り専用で参照できるようにする。認証はパーソナルトークン
 * （/api/integrations/claude で発行、src/lib/mcp-token.ts）の Bearer 認証。
 *
 * クライアント側の登録例:
 *   claude mcp add --transport http mvp-builder https://<host>/api/mcp \
 *     --header "Authorization: Bearer <token>"
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import { verifyMcpToken } from "@/lib/mcp-token";
import {
  getOwnedProject,
  getProjectWithArtifacts,
  listProjectsWithStats,
  loadDesignRequest,
  loadEngineerRequest,
} from "@/lib/projects";
import { listUserVoices } from "@/lib/user-voices";

export const runtime = "nodejs";

/** 入力資料の全文は巨大になり得るため、既定でこの文字数に丸めて返す。 */
const SOURCE_TEXT_LIMIT = 20_000;

function ownerIdOf(authInfo: AuthInfo | undefined): string {
  const ownerId = authInfo?.extra?.ownerId;
  if (typeof ownerId !== "string" || !ownerId) {
    throw new Error("Unauthorized: missing owner in token");
  }
  return ownerId;
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function truncate(text: string, limit: number) {
  if (text.length <= limit) return { text, truncated: false };
  return {
    text: `${text.slice(0, limit)}\n…(truncated: ${text.length} chars total)`,
    truncated: true,
  };
}

const projectIdShape = {
  projectId: z
    .string()
    .describe(
      "プロジェクトID（UUID）。studio ページの URL（https://…/studio/<uuid>）をそのまま渡してもよい。",
    ),
};

const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** UUID 単体・studio URL のどちらからでもプロジェクトIDを取り出す。 */
function resolveProjectId(input: string): string | null {
  return input.match(UUID_RE)?.[0]?.toLowerCase() ?? null;
}

const invalidProjectId = () =>
  json({ error: "invalid projectId: pass a project UUID or a /studio/<id> URL" });

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_projects",
      "自分のプロジェクト一覧（id / 名前 / ステータス / 概要 / 更新日時）を返す。他のツールの projectId はここから取得する。",
      {},
      async (_args, extra) => {
        const ownerId = ownerIdOf(extra.authInfo);
        const rows = await listProjectsWithStats(ownerId);
        return json(
          rows.map((p) => ({
            id: p.id,
            name: p.name,
            summary: p.summary,
            status: p.status,
            hasPrototype: p.hasPrototype,
            updatedAt: p.updatedAt,
          })),
        );
      },
    );

    server.tool(
      "get_project",
      "プロジェクトの分析・設計成果物一式を返す（概要 / 入力資料 / JTBD分析 / アクター / ユースケース / OOUI / ジャーニー / 市場分析 / ナビゲーション / ワイヤー / データモデル / バックエンド要否 / スコープ / MVPステートメント / KPI / グロース計画 / ブランド）。projectId には studio ページの URL をそのまま渡せる。プロトタイプHTMLや提案資料スライドは含まない（get_prototype / get_deck を使う）。",
      projectIdShape,
      async ({ projectId: rawId }, extra) => {
        const ownerId = ownerIdOf(extra.authInfo);
        const projectId = resolveProjectId(rawId);
        if (!projectId) return invalidProjectId();
        const snapshot = await getProjectWithArtifacts(ownerId, projectId);
        if (!snapshot) return json({ error: "project not found" });
        const source = truncate(snapshot.sourceText ?? "", SOURCE_TEXT_LIMIT);
        return json({
          project: {
            id: snapshot.project.id,
            name: snapshot.project.name,
            summary: snapshot.project.summary,
            status: snapshot.project.status,
            createdAt: snapshot.project.createdAt,
            updatedAt: snapshot.project.updatedAt,
          },
          detail: snapshot.detail,
          analysisResult: snapshot.analysisResult,
          sourceText: source.text,
          sourceTextTruncated: source.truncated,
          actors: snapshot.actors,
          useCases: snapshot.useCases,
          ooui: snapshot.ooui,
          journey: snapshot.journey,
          market: snapshot.market,
          navigation: snapshot.navigation,
          wireframes: snapshot.wireframes,
          dataModel: snapshot.dataModel,
          backend: snapshot.backend,
          scope: snapshot.scope,
          mvpStatement: snapshot.mvpStatement,
          kpi: snapshot.kpi,
          growthPlan: snapshot.growthPlan,
          brand: snapshot.brand,
          prototype: snapshot.prototype
            ? {
                status: snapshot.prototype.status,
                demoUrl: snapshot.prototype.demoUrl,
                deploymentUrl: snapshot.prototype.deploymentUrl,
                githubRepoUrl: snapshot.prototype.githubRepoUrl,
                updatedAt: snapshot.prototype.updatedAt,
              }
            : null,
        });
      },
    );

    server.tool(
      "get_prototype",
      "プロトタイプの公開URL・ステータスを返す。includeSource=true で画面別ソースコード（DSエンジン）と自己完結HTMLも返す（大きいので必要な時だけ）。",
      {
        ...projectIdShape,
        includeSource: z
          .boolean()
          .optional()
          .describe("画面別ソース・HTML本体を含めるか（既定 false）"),
      },
      async ({ projectId: rawId, includeSource }, extra) => {
        const ownerId = ownerIdOf(extra.authInfo);
        const projectId = resolveProjectId(rawId);
        if (!projectId) return invalidProjectId();
        const snapshot = await getProjectWithArtifacts(ownerId, projectId);
        if (!snapshot) return json({ error: "project not found" });
        const proto = snapshot.prototype;
        if (!proto) return json({ error: "prototype not generated yet" });
        return json({
          status: proto.status,
          demoUrl: proto.demoUrl,
          deploymentUrl: proto.deploymentUrl,
          githubRepoUrl: proto.githubRepoUrl,
          updatedAt: proto.updatedAt,
          screens: (proto.dsScreens ?? []).map((s) => ({
            label: s.label,
            componentName: s.componentName,
            parent: s.parent ?? null,
            failed: s.failed,
            ...(includeSource ? { source: s.source } : {}),
          })),
          ...(includeSource ? { html: proto.html } : {}),
        });
      },
    );

    server.tool(
      "get_deck",
      "提案資料（スライドデータ / figma-slide-gen 互換の slideData 配列）を返す。",
      projectIdShape,
      async ({ projectId: rawId }, extra) => {
        const ownerId = ownerIdOf(extra.authInfo);
        const projectId = resolveProjectId(rawId);
        if (!projectId) return invalidProjectId();
        const project = await getOwnedProject(ownerId, projectId);
        if (!project) return json({ error: "project not found" });
        return json({ deck: project.deck ?? null });
      },
    );

    server.tool(
      "get_briefs",
      "デザイナー依頼ブリーフとエンジニア依頼ブリーフ（開発仕様）を返す。",
      projectIdShape,
      async ({ projectId: rawId }, extra) => {
        const ownerId = ownerIdOf(extra.authInfo);
        const projectId = resolveProjectId(rawId);
        if (!projectId) return invalidProjectId();
        const project = await getOwnedProject(ownerId, projectId);
        if (!project) return json({ error: "project not found" });
        const [design, engineer] = await Promise.all([
          loadDesignRequest(ownerId, projectId),
          loadEngineerRequest(ownerId, projectId),
        ]);
        return json({
          designRequest: design
            ? {
                status: design.status,
                brief: design.brief,
                figmaUrl: design.figmaUrl,
                refinedNote: design.refinedNote,
              }
            : null,
          engineerRequest: engineer
            ? {
                status: engineer.status,
                brief: engineer.brief,
                deliverable: engineer.deliverable,
                deadline: engineer.deadline,
              }
            : null,
        });
      },
    );

    server.tool(
      "get_user_voices",
      "公開プロトタイプに埋め込んだウィジェットから集まった実ユーザーの声（JTBDインタビュー全文と構造化サマリ）を返す。",
      projectIdShape,
      async ({ projectId: rawId }, extra) => {
        const ownerId = ownerIdOf(extra.authInfo);
        const projectId = resolveProjectId(rawId);
        if (!projectId) return invalidProjectId();
        const project = await getOwnedProject(ownerId, projectId);
        if (!project) return json({ error: "project not found" });
        const voices = await listUserVoices(projectId);
        return json(voices);
      },
    );
  },
  {
    serverInfo: { name: "mvp-builder", version: "0.1.0" },
  },
  {
    basePath: "/api",
    disableSse: true,
    maxDuration: 60,
  },
);

const verifyToken = async (
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> => {
  const claims = verifyMcpToken(bearerToken);
  if (!claims) return undefined;
  return {
    token: bearerToken!,
    clientId: claims.ownerId,
    scopes: ["read"],
    expiresAt: claims.exp,
    extra: { ownerId: claims.ownerId },
  };
};

const authedHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authedHandler as GET, authedHandler as POST, authedHandler as DELETE };
