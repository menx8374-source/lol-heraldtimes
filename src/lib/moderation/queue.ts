/**
 * 保留キュー（F9）の読み取り専用ヘルパ。status="held" の記事は閲覧系クエリ（lib/articles.ts）から
 * 除外されるため、保留理由の確認・運営監視（Sprint 9 ダッシュボードの土台）にはここを使う。
 */
import { prisma } from "@/lib/prisma";

export type HeldArticleSummary = {
  slug: string;
  title: string;
  category: string;
  heldReason: string | null;
  heldDetail: string | null;
  createdAt: Date;
};

/**
 * 保留キュー: status="held" の記事を新しい順で取得する。
 * take を指定すると DB 側で件数を絞る（保留が解消されず積み上がっても無界に全件取得しないため）。
 */
export async function listHeldArticles(options: { take?: number } = {}): Promise<HeldArticleSummary[]> {
  return prisma.article.findMany({
    where: { status: "held" },
    select: { slug: true, title: true, category: true, heldReason: true, heldDetail: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    ...(options.take != null ? { take: options.take } : {}),
  });
}
