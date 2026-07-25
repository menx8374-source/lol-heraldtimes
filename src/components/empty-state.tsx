/** 記事0件時の空状態表示。カテゴリ／タグ／検索結果0件をエラーにせずここで表現する。 */
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded border border-dashed border-neutral-300 bg-white px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      {message}
    </p>
  );
}
