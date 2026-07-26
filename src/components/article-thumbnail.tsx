import { isSafeImageUrl } from "@/lib/image-url";
import { categorySlugFor } from "@/lib/categories";

/** thumbnailUrl未設定/不正なURL、かつカテゴリ不明時に表示する汎用LoLテーマの既定サムネイル画像（拡張E19）。 */
const DEFAULT_THUMBNAIL_SRC = "/default-thumb.svg";

/**
 * サムネイル画像枠。thumbnailUrl が安全なURL（自サイトのルート相対パス、または https の外部URL）
 * のときはそれを表示する。未設定/不正なURLのときは、category が既知のカテゴリなら
 * カテゴリ別の既定サムネイル画像（`/default-thumb-<categorySlug>.svg`、拡張E31 F-E31-3）を、
 * カテゴリ不明時のみ従来の汎用既定サムネイル画像を表示する。
 */
export function ArticleThumbnail({
  thumbnailUrl,
  category,
  className = "",
}: {
  thumbnailUrl: string | null;
  /** 記事のカテゴリ表示ラベル（未指定/未知のカテゴリは汎用既定画像にフォールバック）。 */
  category?: string | null;
  className?: string;
}) {
  const categorySlug = category ? categorySlugFor(category) : undefined;
  const defaultSrc = categorySlug ? `/default-thumb-${categorySlug}.svg` : DEFAULT_THUMBNAIL_SRC;
  const src = isSafeImageUrl(thumbnailUrl) ? thumbnailUrl : defaultSrc;

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
