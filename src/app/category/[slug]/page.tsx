import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryLabelForSlug } from "@/lib/categories";
import { listArticlesByCategory, listPopularArticles } from "@/lib/articles";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { PickupCarousel } from "@/components/pickup-carousel";
import { Pagination } from "@/components/pagination";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

/** 注目記事PICKUPの表示件数（トップページと揃える）。 */
const PICKUP_LIMIT = 5;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({
  params,
}: Pick<Props, "params">): Promise<Metadata> {
  const { slug } = await params;
  const category = categoryLabelForSlug(slug);
  return { title: category ? `${category} の記事一覧` : "カテゴリが見つかりません" };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const category = categoryLabelForSlug(slug);

  if (!category) {
    notFound();
  }

  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  // 注目記事PICKUPはカテゴリを問わない全体の注目記事（トップページと同じ）を表示する。
  const [result, pickup] = await Promise.all([
    listArticlesByCategory(category, requestedPage),
    listPopularArticles(PICKUP_LIMIT),
  ]);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: category, path: `/category/${slug}` },
        ]}
      />
      <PickupCarousel articles={pickup} />
      <h1 className="mb-4 text-lg font-bold">{category}</h1>
      <ArticleList articles={result.items} emptyMessage="記事がありません" />
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => `/category/${slug}?page=${p}`}
      />
    </PageWithSidebar>
  );
}
