import Link from "next/link";
import type { ArticleSummary } from "@/lib/articles";

/** サイドバー（PC）／記事下相当領域（スマホ）の人気記事ランキングウィジェット（F3）。 */
export function PopularRanking({ articles }: { articles: ArticleSummary[] }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">人気記事ランキング</h2>
      {articles.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">記事がありません</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {articles.map((article, index) => (
            <li key={article.slug} className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-lg font-bold text-sky-700 dark:text-sky-400">
                {index + 1}
              </span>
              <Link
                href={`/articles/${article.slug}`}
                className="min-w-0 text-sm leading-snug break-words hover:underline"
              >
                {article.title}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
