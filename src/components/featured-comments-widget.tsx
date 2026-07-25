import Link from "next/link";
import type { FeaturedCommentView } from "@/lib/comments-db";
import { formatRelativeTime, formatPublishedAt } from "@/lib/format";

/**
 * サイドバー「注目コメント」ウィジェット。直近3日間に投稿された公開コメントのうち、
 * 返信・賛否リアクションが多い（=盛り上がっている）ものを表示する（データは listFeaturedComments）。
 */
export function FeaturedCommentsWidget({ comments }: { comments: FeaturedCommentView[] }) {
  return (
    <section
      data-sidebar-widget
      className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
    >
      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">注目コメント</h2>
      {comments.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          直近で盛り上がっているコメントはまだありません
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c, i) => (
            <li key={`${c.articleSlug}-${i}`} className="text-sm">
              <Link href={`/articles/${c.articleSlug}#comments`} className="hover:underline">
                <p className="break-words text-neutral-800 dark:text-neutral-200">{c.excerpt}</p>
                <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {c.articleTitle}
                </p>
              </Link>
              <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">💬</span>
                  <span aria-label="返信数">{c.replyCount}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">👍</span>
                  <span aria-label="Good">{c.goodCount}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span aria-hidden="true">👎</span>
                  <span aria-label="Bad">{c.badCount}</span>
                </span>
                <time
                  dateTime={c.createdAt.toISOString()}
                  title={formatPublishedAt(c.createdAt)}
                  className="text-neutral-400 dark:text-neutral-500"
                >
                  {formatRelativeTime(c.createdAt, new Date())}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
