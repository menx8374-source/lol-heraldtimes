import Link from "next/link";
import type { RecentCommentView } from "@/lib/comments-db";
import { formatRelativeTime, formatPublishedAt } from "@/lib/format";

/** サイドバー「新着コメント」ウィジェット（拡張E2）。全記事横断で直近の公開コメントを表示する。 */
export function RecentCommentsWidget({ comments }: { comments: RecentCommentView[] }) {
  return (
    <section data-sidebar-widget className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">新着コメント</h2>
      {comments.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">まだコメントはありません</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c, i) => (
            <li key={`${c.articleSlug}-${i}`} className="text-sm">
              <Link href={`/articles/${c.articleSlug}#comments`} className="hover:underline">
                <p className="break-words text-neutral-800 dark:text-neutral-200">{c.excerpt}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{c.articleTitle}</p>
              </Link>
              <time
                dateTime={c.createdAt.toISOString()}
                title={formatPublishedAt(c.createdAt)}
                className="text-xs text-neutral-400 dark:text-neutral-500"
              >
                {formatRelativeTime(c.createdAt, new Date())}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
