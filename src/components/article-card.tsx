import Link from "next/link";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { ArticleMeta } from "@/components/article-meta";
import type { ArticleSummary } from "@/lib/articles";

export function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <article className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm sm:gap-4 sm:p-4">
      <ArticleThumbnail
        category={article.category}
        thumbnailUrl={article.thumbnailUrl}
        className="h-16 w-16 shrink-0 rounded-md sm:h-20 sm:w-28"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <ArticleMeta
            category={article.category}
            publishedAt={article.publishedAt}
          />
        </div>
        <h2 className="mt-1 text-sm font-bold leading-snug break-words sm:text-base">
          <Link href={`/articles/${article.slug}`} className="hover:underline">
            {article.title}
          </Link>
        </h2>
      </div>
    </article>
  );
}
