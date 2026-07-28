/**
 * Googleニュース向け news sitemap（成長G5 F-G5-3）。公開から48時間以内の公開記事のみを
 * `<news:news>` 付きで列挙する。自動運営パイプラインが継続的に記事を公開するため、
 * sitemap.ts と同様に毎リクエストDBを再読込する（ビルド時に静的化しない）。
 */
import { listArticlesForNewsSitemap } from "@/lib/articles";
import { buildNewsSitemapXml } from "@/lib/news-sitemap";
import { getSiteUrl, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const siteUrl = getSiteUrl();

  let articles: Awaited<ReturnType<typeof listArticlesForNewsSitemap>> = [];
  try {
    articles = await listArticlesForNewsSitemap();
  } catch (err) {
    // DB取得に失敗しても news sitemap 自体はエラーにせず、空の有効な urlset を返す
    // （クローラへの5xx応答よりも「対象0件」として扱う方が安全）。
    console.error("news-sitemap.xml 用の記事取得に失敗しました:", err);
  }

  const xml = buildNewsSitemapXml(articles, siteUrl, SITE_NAME);

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
