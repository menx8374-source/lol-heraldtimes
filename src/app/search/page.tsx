import type { Metadata } from "next";
import { searchArticles } from "@/lib/search";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  return { title: query ? `「${query}」の検索結果` : "記事を検索" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const articles = query ? await searchArticles(query) : [];

  return (
    <PageWithSidebar>
      <h1 className="mb-4 text-lg font-bold">
        {query ? `「${query}」の検索結果` : "記事を検索"}
      </h1>
      {query ? (
        <ArticleList
          articles={articles}
          emptyMessage="該当する記事が見つかりませんでした"
        />
      ) : (
        <p className="text-sm text-neutral-500">
          ヘッダーの検索ボックスにキーワードを入力して検索してください。
        </p>
      )}
    </PageWithSidebar>
  );
}
