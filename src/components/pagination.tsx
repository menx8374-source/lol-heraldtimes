import Link from "next/link";

/**
 * 一覧ページ共通のページネーションUI（拡張E1）。「前へ／次へ」＋現在ページ表示。
 * 総ページ数が1以下（0件を含む）のときは何も表示しない。
 * `buildHref` は表示ページ番号ごとの遷移先を組み立てる関数（クエリの他パラメータ保持は呼び出し側の責務）。
 */
export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      aria-label="ページネーション"
      className="mt-6 flex items-center justify-center gap-4 text-sm"
    >
      {hasPrev ? (
        <Link
          href={buildHref(page - 1)}
          className="rounded border border-neutral-300 px-3 py-1 text-sky-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-sky-400 dark:hover:bg-neutral-800"
        >
          前へ
        </Link>
      ) : (
        <span className="rounded border border-neutral-200 px-3 py-1 text-neutral-300 dark:border-neutral-800 dark:text-neutral-600">
          前へ
        </span>
      )}
      <span className="text-neutral-600 dark:text-neutral-400">
        {page} / {totalPages} ページ
      </span>
      {hasNext ? (
        <Link
          href={buildHref(page + 1)}
          className="rounded border border-neutral-300 px-3 py-1 text-sky-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-sky-400 dark:hover:bg-neutral-800"
        >
          次へ
        </Link>
      ) : (
        <span className="rounded border border-neutral-200 px-3 py-1 text-neutral-300 dark:border-neutral-800 dark:text-neutral-600">
          次へ
        </span>
      )}
    </nav>
  );
}
