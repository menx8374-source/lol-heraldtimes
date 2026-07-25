import { listPopularArticles } from "@/lib/articles";
import { listRecentComments } from "@/lib/comments-db";
import { PopularRanking } from "@/components/popular-ranking";
import { RecentCommentsWidget } from "@/components/recent-comments-widget";
import { AdSlot } from "@/components/ad-slot";

/**
 * サイト共通のコンテンツ+サイドバー2カラムレイアウト。
 * PC(lg以上)は横並び、スマホは縦積みで人気記事ランキング・新着コメントが本文の下に表示される（F3・拡張E2）。
 */
export async function PageWithSidebar({
  children,
}: {
  children: React.ReactNode;
}) {
  const [popular, recentComments] = await Promise.all([
    listPopularArticles(5),
    listRecentComments(5),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">{children}</div>
      <aside className="w-full shrink-0 lg:w-72">
        <PopularRanking articles={popular} />
        <RecentCommentsWidget comments={recentComments} />
        <AdSlot position="sidebar" />
      </aside>
    </div>
  );
}
