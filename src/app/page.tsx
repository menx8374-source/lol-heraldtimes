import { listArticles } from "@/lib/articles";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";

export default async function HomePage() {
  const articles = await listArticles();

  return (
    <PageWithSidebar>
      <h1 className="mb-4 text-lg font-bold">新着まとめ記事</h1>
      <ArticleList
        articles={articles}
        emptyMessage="まだ記事がありません。"
        adInterval={4}
      />
    </PageWithSidebar>
  );
}
