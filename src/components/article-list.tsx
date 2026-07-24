import { ArticleCard } from "@/components/article-card";
import { EmptyState } from "@/components/empty-state";
import type { ArticleSummary } from "@/lib/articles";

/**
 * 記事一覧の共通表示（トップ／カテゴリ／タグ／検索結果／関連記事で共用）。
 * 0件時は emptyMessage で空状態を表示し、エラーにはしない。
 */
export function ArticleList({
  articles,
  emptyMessage,
}: {
  articles: ArticleSummary[];
  emptyMessage: string;
}) {
  if (articles.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {articles.map((article) => (
        <ArticleCard key={article.slug} article={article} />
      ))}
    </div>
  );
}
