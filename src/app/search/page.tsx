import type { Metadata } from "next";
import { searchArticles } from "@/lib/search";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Pagination } from "@/components/pagination";

type Props = {
  searchParams: Promise<{ q?: string; page?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  return { title: query ? `「${query}」の検索結果` : "記事を検索" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q, page: pageParam } = await searchParams;
  const query = (q ?? "").trim();
  const requestedPage = parsePageParam(pageParam);
  const result = query
    ? await searchArticles(query, requestedPage)
    : { items: [], page: 1, pageSize: 0, totalCount: 0, totalPages: 1 };

  return (
    <PageWithSidebar>
      <h1 className="mb-4 text-lg font-bold">
        {query ? `「${query}」の検索結果` : "記事を検索"}
      </h1>
      {query ? (
        <>
          <ArticleList
            articles={result.items}
            emptyMessage="該当する記事が見つかりませんでした"
          />
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            buildHref={(p) => `/search?q=${encodeURIComponent(query)}&page=${p}`}
          />
        </>
      ) : (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          ヘッダーの検索ボックスにキーワードを入力して検索してください。
        </p>
      )}
    </PageWithSidebar>
  );
}
