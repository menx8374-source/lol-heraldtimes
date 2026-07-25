/**
 * 予約投稿（スケジュール公開、拡張E7）。status="scheduled" の記事のうち scheduledAt が到来した
 * ものを status="published" に昇格する。`npm run pipeline`（runFullPipeline）実行時に毎回呼ばれ、
 * 無人運用でも予約時刻の到来だけで自動公開される（cron等での定期実行を想定）。
 * 公開限定クエリ（PUBLISHED_ONLY = status="published"）はこの昇格が起きるまで scheduled 記事を
 * 一切公開サイトへ出さない。
 */
import { prisma } from "@/lib/prisma";

/** 予約時刻が到来しているか（純関数）。 */
export function isScheduleDue(scheduledAt: Date, now: Date): boolean {
  return scheduledAt.getTime() <= now.getTime();
}

export type PromoteScheduledResult = { publishedCount: number; articleIds: string[] };

/**
 * 1回の実行で昇格する予約記事の上限。予約が滞留しても1トランザクションが無界に肥大化しないよう
 * バッチ化する（超過分は次回のパイプライン実行で昇格される。where は status="scheduled" 条件なので
 * 昇格済みは再対象にならず、二重公開もしない）。
 */
const SCHEDULED_PUBLISH_BATCH = 100;

/** scheduledAt <= now の scheduled 記事をまとめて公開状態に昇格する。対象0件でも正常終了する。 */
export async function promoteScheduledArticles(now: Date = new Date()): Promise<PromoteScheduledResult> {
  const due = await prisma.article.findMany({
    where: { status: "scheduled", scheduledAt: { lte: now } },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
    take: SCHEDULED_PUBLISH_BATCH,
  });
  if (due.length === 0) return { publishedCount: 0, articleIds: [] };

  await prisma.$transaction(
    due.map((a) =>
      prisma.article.update({
        where: { id: a.id },
        data: { status: "published", publishedAt: a.scheduledAt ?? now },
      }),
    ),
  );

  return { publishedCount: due.length, articleIds: due.map((a) => a.id) };
}
