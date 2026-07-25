import Link from "next/link";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import type { ArticleSummary } from "@/lib/articles";

/**
 * トップページ上部の注目記事カード列（拡張E1）。閲覧数（viewCount）上位の数件を
 * 横スクロールのカード列で表示する。自動送り等は過剰なので実装しない。
 */
export function PickupCarousel({ articles }: { articles: ArticleSummary[] }) {
  if (articles.length === 0) return null;

  return (
    <section className="mb-6" aria-label="注目記事">
      <h2 className="mb-2 text-sm font-bold text-neutral-600 dark:text-neutral-300">
        注目記事 PICKUP
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {articles.map((article) => (
          <Link
            key={article.slug}
            href={`/articles/${article.slug}`}
            className="flex w-40 shrink-0 flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-sm hover:shadow-md dark:border-neutral-700 dark:bg-neutral-900 sm:w-48"
          >
            <div className="relative">
              <ArticleThumbnail
                category={article.category}
                thumbnailUrl={article.thumbnailUrl}
                className="h-20 w-full rounded-md sm:h-24"
              />
              {article.pinned && (
                <span className="absolute left-1 top-1 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  📌 注目
                </span>
              )}
            </div>
            <p className="line-clamp-2 text-xs font-bold leading-snug sm:text-sm">
              {article.title}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
