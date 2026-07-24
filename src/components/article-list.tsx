import { Fragment } from "react";
import { ArticleCard } from "@/components/article-card";
import { AdSlot } from "@/components/ad-slot";
import { EmptyState } from "@/components/empty-state";
import type { ArticleSummary } from "@/lib/articles";

/**
 * 記事一覧の共通表示（トップ／カテゴリ／タグ／検索結果／関連記事で共用）。
 * 0件時は emptyMessage で空状態を表示し、エラーにはしない。
 *
 * adInterval を指定すると、その件数ごとに一覧内広告枠（F12）を差し込む
 * （トップページの新着一覧のみ指定。カテゴリ／タグ／検索／関連記事は未指定＝広告なし）。
 */
export function ArticleList({
  articles,
  emptyMessage,
  adInterval,
}: {
  articles: ArticleSummary[];
  emptyMessage: string;
  adInterval?: number;
}) {
  if (articles.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {articles.map((article, index) => (
        <Fragment key={article.slug}>
          <ArticleCard article={article} />
          {adInterval &&
            adInterval > 0 &&
            (index + 1) % adInterval === 0 &&
            index !== articles.length - 1 && <AdSlot position="listing" />}
        </Fragment>
      ))}
    </div>
  );
}
