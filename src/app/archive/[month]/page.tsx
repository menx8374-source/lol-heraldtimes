import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isValidMonthKey, listArticlesByMonth, monthLabel } from "@/lib/archive";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Pagination } from "@/components/pagination";
import { Breadcrumbs } from "@/components/breadcrumbs";

type Props = {
  params: Promise<{ month: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { month } = await params;
  return {
    title: isValidMonthKey(month) ? `${monthLabel(month)}の記事一覧` : "アーカイブが見つかりません",
  };
}

/**
 * 月別アーカイブの記事一覧ページ（拡張E4）。"YYYY-MM" 形式でない不正なセグメントは404にする。
 * 形式は正しいが該当月の記事が0件の場合は404にせず空状態を表示する。
 */
export default async function ArchiveMonthPage({ params, searchParams }: Props) {
  const { month } = await params;

  if (!isValidMonthKey(month)) {
    notFound();
  }

  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);
  const result = await listArticlesByMonth(month, requestedPage);

  if (!result) {
    notFound();
  }

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "月別アーカイブ", path: "/archive" },
          { name: monthLabel(month), path: `/archive/${month}` },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">{monthLabel(month)}</h1>
      <ArticleList articles={result.items} emptyMessage="記事がありません" />
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        buildHref={(p) => `/archive/${month}?page=${p}`}
      />
    </PageWithSidebar>
  );
}
