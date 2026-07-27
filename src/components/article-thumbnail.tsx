import { isSafeImageUrl } from "@/lib/image-url";
import { categorySlugFor, isReactionCategory } from "@/lib/categories";
import { pickDeterministicChampionSplashUrl } from "@/lib/generation/champion-splash";

/** thumbnailUrl未設定/不正なURL、かつカテゴリ不明時に表示する汎用LoLテーマの既定サムネイル画像（拡張E19）。 */
const DEFAULT_THUMBNAIL_SRC = "/default-thumb.svg";

/**
 * サムネイル画像枠。src の決定は次の優先順（拡張E38 F-E38-3）:
 * 1. thumbnailUrl が安全なURL（自サイトのルート相対パス、または https の外部URL）ならそれ
 *    （E37以降に生成された反応記事はここで保存済みのチャンピオンアートを表示する）。
 * 2. でなく、category が反応カテゴリ（5chの反応/海外の反応）かつ slug があれば、
 *    slugから決定論的に選んだチャンピオンの公式スプラッシュ（E37より前に生成された既存の
 *    反応記事も、再生成なしでチャンピオンアートになる）。
 * 3. どちらでもなければ従来のカテゴリ別/汎用既定サムネイル画像（`/default-thumb-<slug>.svg`等）。
 */
export function ArticleThumbnail({
  thumbnailUrl,
  category,
  slug,
  className = "",
  alt = "",
}: {
  thumbnailUrl: string | null;
  /** 記事のカテゴリ表示ラベル(未指定/未知のカテゴリは汎用既定画像にフォールバック)。 */
  category?: string | null;
  /** 記事slug。反応カテゴリでthumbnailUrl未設定のとき、決定論スプラッシュのキーに使う。 */
  slug?: string;
  className?: string;
  /** 画像のalt属性(拡張E50: 記事冒頭ヒーロー表示では記事タイトルを渡す。未指定時は装飾画像として空文字)。 */
  alt?: string;
}) {
  const categorySlug = category ? categorySlugFor(category) : undefined;
  const defaultSrc = categorySlug ? `/default-thumb-${categorySlug}.svg` : DEFAULT_THUMBNAIL_SRC;

  let src: string;
  if (isSafeImageUrl(thumbnailUrl)) {
    src = thumbnailUrl;
  } else if (isReactionCategory(category) && slug) {
    src = pickDeterministicChampionSplashUrl(slug);
  } else {
    src = defaultSrc;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 外部APIの画像URL、またはローカルの既定/モック画像のみを表示対象とする（信頼境界: isSafeImageUrlでhttps/ローカルパスを検証済み）
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`object-cover ${className}`}
    />
  );
}
