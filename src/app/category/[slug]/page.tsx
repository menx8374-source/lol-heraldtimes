import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { categoryLabelForSlug } from "@/lib/categories";
import { listArticlesByCategory } from "@/lib/articles";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Pagination } from "@/components/pagination";
import { Breadcrumbs } from "@/components/breadcrumbs";

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
  const result = await listArticlesByCategory(category, requestedPage);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: category, path: `/category/${slug}` },
        ]}
      />
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
