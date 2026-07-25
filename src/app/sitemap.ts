import type { MetadataRoute } from "next";
import { listArticlesForSitemap } from "@/lib/articles";
import { CATEGORY_LABELS, categorySlugFor } from "@/lib/categories";
import { listAllTagNames } from "@/lib/tags";
import { listArchiveMonths } from "@/lib/archive";
import { getSiteUrl, articleUrl } from "@/lib/site";
import { CHAMPIONS } from "@/lib/lol-data/champions";
import { PATCHES } from "@/lib/lol-data/patches";

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

  const [articles, tagNames, archiveMonths] = await Promise.all([
    listArticlesForSitemap(),
    listAllTagNames(),
    listArchiveMonths(),
  ]);

  const articleEntries: MetadataRoute.Sitemap = articles.map((article) => ({
    url: articleUrl(article.slug),
    lastModified: article.updatedAt,
  }));

  const categoryEntries: MetadataRoute.Sitemap = CATEGORY_LABELS.map((label) => ({
    url: `${siteUrl}/category/${categorySlugFor(label)}`,
  }));

  const tagEntries: MetadataRoute.Sitemap = tagNames.map((name) => ({
    url: `${siteUrl}/tags/${encodeURIComponent(name)}`,
  }));

  const archiveEntries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/archive` },
    ...archiveMonths.map((month) => ({ url: `${siteUrl}/archive/${month.key}` })),
  ];

  // 攻略・データ固定ページ（拡張E6）。DB非依存の静的モックデータで、語彙数が有界なため
  // 記事数が増え続けてもサイトマップが線形に膨張しない。
  const lolDataEntries: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/champions` },
    ...CHAMPIONS.map((c) => ({ url: `${siteUrl}/champions/${c.slug}` })),
    { url: `${siteUrl}/patches` },
    ...PATCHES.map((p) => ({ url: `${siteUrl}/patches/${p.slug}` })),
    { url: `${siteUrl}/tier` },
    { url: `${siteUrl}/glossary` },
  ];

  return [
    { url: siteUrl },
    ...categoryEntries,
    ...tagEntries,
    ...archiveEntries,
    ...lolDataEntries,
    ...articleEntries,
  ];
}
