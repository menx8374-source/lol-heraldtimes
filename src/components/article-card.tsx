import Link from "next/link";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { ArticleMeta } from "@/components/article-meta";
import type { ArticleSummary } from "@/lib/articles";

/**
 * 記事一覧カード（拡張E9でおばにゅー風の横広レイアウトに刷新）。
 * 左に大きめのサムネイル、右にタイトル＋本文抜粋（1レス目プレビュー等）＋メタ情報を横並びにし、
 * 一覧の横幅（page-with-sidebar.tsx側でmax-w-7xlへ拡張済み）を活かして読みやすくする。
 * PC(sm以上)ではサムネイルを大きく、スマホでは小さめのまま崩れないようにする。
 */
export function ArticleCard({ article }: { article: ArticleSummary }) {
  return (
    <article
      data-article-card
      className="flex gap-3 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm sm:gap-5 sm:p-4 dark:border-neutral-700 dark:bg-neutral-900"
    >
      <ArticleThumbnail
        thumbnailUrl={article.thumbnailUrl}
        category={article.category}
        className="h-16 w-16 shrink-0 rounded-md sm:h-24 sm:w-40 md:h-28 md:w-48"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <ArticleMeta
            category={article.category}
            publishedAt={article.publishedAt}
          />
        </div>
        <h2 className="mt-1 text-sm font-bold leading-snug break-words sm:text-base md:text-lg">
          {article.pinned && (
            <span className="mr-1 inline-block rounded bg-amber-500 px-1.5 py-0.5 align-middle text-[10px] font-bold text-white">
              📌 注目
            </span>
          )}
          <Link href={`/articles/${article.slug}`} className="hover:underline">
            {article.title}
          </Link>
        </h2>
        {article.excerpt && (
          <p className="mt-1.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400 sm:text-sm">
            {article.excerpt}
          </p>
        )}
        <div className="mt-1.5 flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
          <span aria-hidden="true">💬</span>
          <span>{article.commentCount}</span>
        </div>
      </div>
    </article>
  );
}
