import { formatPublishedAt } from "@/lib/format";

/**
 * 記事のメタ情報行（カテゴリバッジ＋投稿日時）。記事カードと個別記事ページで共用する。
 * flex コンテナは呼び出し側が用意し、この中身をフラグメントで差し込む。
 */
export function ArticleMeta({
  category,
  publishedAt,
}: {
  category: string;
  publishedAt: Date;
}) {
  return (
    <>
      <span className="rounded border border-neutral-300 bg-neutral-100 px-2 py-0.5">
        {category}
      </span>
      <time dateTime={publishedAt.toISOString()}>
        {formatPublishedAt(publishedAt)}
      </time>
    </>
  );
}
