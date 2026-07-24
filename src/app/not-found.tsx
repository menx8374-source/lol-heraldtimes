import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">404 - ページが見つかりません</h1>
      <p className="text-sm text-neutral-500">
        お探しの記事・ページは削除されたか、URLが間違っている可能性があります。
      </p>
      <Link
        href="/"
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
      >
        トップページへ戻る
      </Link>
    </div>
  );
}
