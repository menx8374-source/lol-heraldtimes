import { formatPublishedAt, formatRelativeTime } from "@/lib/format";

/**
 * 記事のメタ情報行（カテゴリバッジ＋投稿日時）。記事カードと個別記事ページで共用する。
 * flex コンテナは呼び出し側が用意し、この中身をフラグメントで差し込む。
 * 投稿日時は相対表示（拡張E1。「3時間前」等）にし、絶対日時は title 属性（ホバー時表示）で保持する。
 * サーバーコンポーネントとして描画時（=サーバー時刻）に一度だけ相対時刻を算出する。
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
      <span className="rounded border border-neutral-300 bg-neutral-100 px-2 py-0.5 dark:border-neutral-600 dark:bg-neutral-800">
        {category}
      </span>
      <time
        dateTime={publishedAt.toISOString()}
        title={formatPublishedAt(publishedAt)}
      >
        {formatRelativeTime(publishedAt, new Date())}
      </time>
    </>
  );
}
