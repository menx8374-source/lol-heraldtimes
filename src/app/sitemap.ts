import type { MetadataRoute } from "next";
import { listArticlesForSitemap } from "@/lib/articles";
import { categorySlugFor } from "@/lib/categories";
import { listVisibleCategoryLabels } from "@/lib/category-visibility";
import { listAllTagNames } from "@/lib/tags";
import { listArchiveMonths } from "@/lib/archive";
import { getSiteUrl, articleUrl } from "@/lib/site";

// 自動運営パイプラインが継続的に記事を公開するため、サイトマップはビルド時に
// 静的化せず毎リクエストDBを再読込する（そうしないと next build 直後のスナップショット
// に固定され、後から公開された記事がサイトマップに反映されない）。
export const dynamic = "force-dynamic";

/**
 * サイトマップ（F13 + 拡張E4）。全公開記事（status="published" のみ。保留記事は含めない）・
 * 全カテゴリページ・タグページ・月別アーカイブページを列挙する。トップページも含める。
 * タグ・アーカイブ月の総数は記事数とは独立に語彙として有界（チャンピオン名/月単位）なため、
 * 記事数が増え続けても線形に膨張しない。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = getSiteUrl();

  const [articles, tagNames, archiveMonths, visibleCategories] = await Promise.all([
    listArticlesForSitemap(),
    listAllTagNames(),
    listArchiveMonths(),
    listVisibleCategoryLabels(),
  ]);

  const articleEntries: MetadataRoute.Sitemap = articles.map((article) => ({
    url: articleUrl(article.slug),
    lastModified: article.updatedAt,
  }));

  // 公開記事が1件も無いカテゴリはsitemapに出さない（リファクタリングS7a F-S7a-2。
  // カテゴリ個別ページ自体は従来どおり存在し、直リンクは可能なまま）。
  const categoryEntries: MetadataRoute.Sitemap = visibleCategories.map((label) => ({
    url: `${siteUrl}/category/${categorySlugFor(label)}`,
  }));

  const tagEntries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/tags` },
    ...tagNames.map((name) => ({ url: `${siteUrl}/tags/${encodeURIComponent(name)}` })),
  ];

  const archiveEntries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/archive` },
    ...archiveMonths.map((month) => ({ url: `${siteUrl}/archive/${month.key}` })),
  ];

  // 攻略・データ固定ページ。/champions・/tier・/patches は運用方針変更でヘッダー導線・サイトマップ
  // から除外した（拡張E34b。ルート実体は残置＝直リンクのみ）。用語集のみ残す。
  const lolDataEntries: MetadataRoute.Sitemap = [{ url: `${siteUrl}/glossary` }];

  return [
    { url: siteUrl },
    ...categoryEntries,
    ...tagEntries,
    ...archiveEntries,
    ...lolDataEntries,
    ...articleEntries,
  ];
}
