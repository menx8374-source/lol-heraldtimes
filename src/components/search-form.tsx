/**
 * サイト内検索ボックス（F4）。GET フォームで /search?q=... に遷移するだけの
 * 素のHTMLフォームとし、クライアントJSに依存しない。
 */
export function SearchForm() {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      className="flex w-full max-w-xs items-center gap-2 sm:w-auto"
    >
      <input
        type="search"
        name="q"
        placeholder="キーワードで検索"
        aria-label="記事を検索"
        className="w-full min-w-0 rounded border border-neutral-600 bg-neutral-800 px-2 py-1 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
      />
      <button
        type="submit"
        className="shrink-0 rounded bg-sky-600 px-3 py-1 text-sm font-medium hover:bg-sky-500"
      >
        検索
      </button>
    </form>
  );
}
