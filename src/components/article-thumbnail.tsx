import {
  CATEGORY_GRADIENTS,
  DEFAULT_CATEGORY_GRADIENT,
} from "@/lib/categories";

/**
 * サムネイル画像枠。thumbnailUrl 未設定時はカテゴリごとの色分けプレースホルダーを表示する。
 * 実画像の調達・最適化は本スプリントの対象外（表示領域の確保のみ）。
 */
export function ArticleThumbnail({
  category,
  thumbnailUrl,
  className = "",
}: {
  category: string;
  thumbnailUrl: string | null;
  className?: string;
}) {
  if (thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 外部サムネイルURLは任意設定・本スプリントでは未使用のフォールバック描画
      <img src={thumbnailUrl} alt="" className={`object-cover ${className}`} />
    );
  }

  const gradient =
    CATEGORY_GRADIENTS[category as keyof typeof CATEGORY_GRADIENTS] ??
    DEFAULT_CATEGORY_GRADIENT;

  return (
    <div
      className={`flex items-center justify-center bg-gradient-to-br ${gradient} text-white text-xs font-medium ${className}`}
      aria-hidden="true"
    >
      {category}
    </div>
  );
}
