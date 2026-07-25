import { isSafeImageUrl } from "@/lib/image-url";

/** thumbnailUrl未設定/不正なURLの記事に表示する汎用LoLテーマの既定サムネイル画像（拡張E19）。 */
const DEFAULT_THUMBNAIL_SRC = "/default-thumb.svg";

/**
 * サムネイル画像枠。thumbnailUrl が安全なURL（自サイトのルート相対パス、または https の外部URL）
 * のときはそれを表示し、未設定または不正なURLのときは汎用のLoL既定サムネイル画像を表示する
 * （カテゴリ色のプレースホルダーは拡張E19で廃止）。
 */
export function ArticleThumbnail({
  thumbnailUrl,
  className = "",
}: {
  thumbnailUrl: string | null;
  className?: string;
}) {
  const src = isSafeImageUrl(thumbnailUrl) ? thumbnailUrl : DEFAULT_THUMBNAIL_SRC;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 外部APIの画像URL、またはローカルの既定/モック画像のみを表示対象とする（信頼境界: isSafeImageUrlでhttps/ローカルパスを検証済み）
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className={`object-cover ${className}`}
    />
  );
}
