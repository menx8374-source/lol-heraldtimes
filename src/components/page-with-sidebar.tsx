import { listPopularArticles } from "@/lib/articles";
import { listRecentComments } from "@/lib/comments-db";
import { listPopularTags } from "@/lib/tags";
import { listArchiveMonths } from "@/lib/archive";
import { PopularRanking } from "@/components/popular-ranking";
import { RecentCommentsWidget } from "@/components/recent-comments-widget";
import { TagCloud } from "@/components/tag-cloud";
import { ArchiveWidget } from "@/components/archive-widget";
import { AdSlot } from "@/components/ad-slot";
import { BlogRankingSlot } from "@/components/blog-ranking-slot";

/** サイドバーの月別アーカイブウィジェットに表示する最大件数（全件は /archive で見られる）。 */
const ARCHIVE_WIDGET_MONTH_LIMIT = 6;

/**
 * サイト共通のコンテンツ+サイドバー2カラムレイアウト。
 * PC(lg以上)は横並び、スマホは縦積みで人気記事ランキング・新着コメント・人気タグ・
 * 月別アーカイブが本文の下に表示される（F3・拡張E2・拡張E4）。
 */
export async function PageWithSidebar({
  children,
}: {
  children: React.ReactNode;
}) {
  const [popular, recentComments, popularTags, archiveMonths] = await Promise.all([
    listPopularArticles(5),
    listRecentComments(5),
    listPopularTags(20),
    listArchiveMonths(ARCHIVE_WIDGET_MONTH_LIMIT),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">{children}</div>
      <aside className="w-full shrink-0 lg:w-72">
        <PopularRanking
          initialArticles={popular.map((a) => ({ slug: a.slug, title: a.title }))}
        />
        <RecentCommentsWidget comments={recentComments} />
        <TagCloud tags={popularTags} />
        <ArchiveWidget months={archiveMonths.slice(0, ARCHIVE_WIDGET_MONTH_LIMIT)} />
        <AdSlot position="sidebar" />
        <BlogRankingSlot />
      </aside>
    </div>
  );
}
