import { listPopularArticles } from "@/lib/articles";
import { PopularRanking } from "@/components/popular-ranking";

/**
 * サイト共通のコンテンツ+サイドバー2カラムレイアウト。
 * PC(lg以上)は横並び、スマホは縦積みで人気記事ランキングが本文の下に表示される（F3）。
 */
export async function PageWithSidebar({
  children,
}: {
  children: React.ReactNode;
}) {
  const popular = await listPopularArticles(5);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">{children}</div>
      <aside className="w-full shrink-0 lg:w-72">
        <PopularRanking articles={popular} />
      </aside>
    </div>
  );
}
