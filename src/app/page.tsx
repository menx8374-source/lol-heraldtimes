import { listArticles } from "@/lib/articles";
import { ArticleCard } from "@/components/article-card";

export default async function HomePage() {
  const articles = await listArticles();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-4 text-lg font-bold">新着まとめ記事</h1>
      {articles.length === 0 ? (
        <p className="text-sm text-neutral-500">まだ記事がありません。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((article) => (
            <ArticleCard key={article.slug} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
