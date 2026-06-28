/**
 * 実ユーザー（回答者）の声の永続化。
 *
 * 公開プロト(/run)に埋め込んだウィジェットから匿名回答者が送るため、
 * ビルダーの所有者チェックは行わない（projectId 紐付けのみ）。
 * 回答者ごと（projectId × respondentId）に 1 行を upsert し、毎ターン全文を上書きする。
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userVoices } from "@/lib/db/schema";

export interface VoiceMessage {
  role: string;
  content: string;
}

/** 回答者の声を upsert（projectId × respondentId で 1 行）。 */
export async function saveUserVoice(
  projectId: string,
  respondentId: string,
  data: {
    messages: VoiceMessage[];
    jobSummary?: Record<string, unknown> | null;
    status?: "in_progress" | "completed";
  },
): Promise<void> {
  const existing = await db
    .select({ id: userVoices.id })
    .from(userVoices)
    .where(
      and(
        eq(userVoices.projectId, projectId),
        eq(userVoices.respondentId, respondentId),
      ),
    )
    .limit(1);

  const values = {
    messages: data.messages,
    jobSummary: data.jobSummary ?? null,
    status: data.status ?? "in_progress",
    updatedAt: new Date(),
  };

  if (existing.length) {
    await db
      .update(userVoices)
      .set(values)
      .where(eq(userVoices.id, existing[0].id));
  } else {
    await db.insert(userVoices).values({ projectId, respondentId, ...values });
  }
}

/** ビルダー側で回答一覧を読む（Phase 2 の集計ビュー用）。 */
export async function listUserVoices(projectId: string) {
  return db
    .select()
    .from(userVoices)
    .where(eq(userVoices.projectId, projectId))
    .orderBy(desc(userVoices.updatedAt));
}
