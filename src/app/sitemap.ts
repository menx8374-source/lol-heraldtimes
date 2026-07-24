import type { MetadataRoute } from "next";
import { listArticlesForSitemap } from "@/lib/articles";
import { CATEGORY_LABELS, categorySlugFor } from "@/lib/categories";
import { getSiteUrl, articleUrl } from "@/lib/site";

// 自動運営パイプラインが継続的に記事を公開するため、サイトマップはビルド時に
// 静的化せず毎リクエストDBを再読込する（そうしないと next build 直後のスナップショット
// に固定され、後から公開された記事がサイトマップに反映されない）。
export const dynamic = "force-dynamic";

/**
 * サイトマップ（F13）。全公開記事（status="published" のみ。保留記事は含めない）と
 * 全カテゴリページを列挙する。トップページも含める。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const articles = await listArticlesForSitemap();

  const articleEntries: MetadataRoute.Sitemap = articles.map((article) => ({
    url: articleUrl(article.slug),
    lastModified: article.updatedAt,
  }));

  const categoryEntries: MetadataRoute.Sitemap = CATEGORY_LABELS.map((label) => ({
    url: `${siteUrl}/category/${categorySlugFor(label)}`,
  }));

  return [{ url: siteUrl }, ...categoryEntries, ...articleEntries];
}
