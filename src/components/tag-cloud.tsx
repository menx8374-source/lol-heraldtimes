import Link from "next/link";
import { tagCloudSizeClass, type TagCount } from "@/lib/tags";

/** サイドバー「人気タグ」ウィジェット（拡張E4）。記事数の多いタグほど大きい文字で表示する。 */
export function TagCloud({ tags }: { tags: TagCount[] }) {
  const maxCount = tags[0]?.count ?? 0;

  return (
    <section data-sidebar-widget className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">人気タグ</h2>
      {tags.length === 0 ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">タグがありません</p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {tags.map((tag) => (
            <Link
              key={tag.name}
              href={`/tags/${tag.name}`}
              className={`${tagCloudSizeClass(tag.count, maxCount)} leading-none text-sky-700 hover:underline dark:text-sky-400`}
            >
              #{tag.name}
              <span className="ml-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">{tag.count}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
