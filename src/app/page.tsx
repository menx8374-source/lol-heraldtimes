import { listArticles, listPopularArticles } from "@/lib/articles";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { PickupCarousel } from "@/components/pickup-carousel";
import { Pagination } from "@/components/pagination";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

const PICKUP_LIMIT = 5;

type Props = {
  searchParams: Promise<{ page?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  const [result, pickup] = await Promise.all([
    listArticles(requestedPage),
    listPopularArticles(PICKUP_LIMIT),
  ]);

  return (
    <PageWithSidebar>
      <PickupCarousel articles={pickup} />
      <h1 className="mb-4 text-lg font-bold">新着まとめ記事</h1>
      <ArticleList
        articles={result.items}
        emptyMessage="まだ記事がありません。"
        adInterval={4}
      />
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => (p === 1 ? "/" : `/?page=${p}`)}
      />
    </PageWithSidebar>
  );
}
