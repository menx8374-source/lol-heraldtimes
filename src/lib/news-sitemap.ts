/**
 * Googleニュース向け news sitemap（成長G5 F-G5-3）の組み立てを担う純関数群。DB非依存にし、
 * 48時間フィルタ・XMLエスケープを含めてテストで検証できるようにする
 * （app/news-sitemap.xml/route.ts から DB取得結果を渡して呼ぶ）。
 */
import { escapeXml } from "@/lib/feed";

/** news sitemap の対象ウィンドウ（公開から48時間以内）。 */
export const NEWS_SITEMAP_WINDOW_MS = 48 * 60 * 60 * 1000;

export type NewsSitemapArticle = {
  slug: string;
  title: string;
  publishedAt: Date;
};

/**
 * 指定日時が「公開から48時間以内」かどうかを判定する。`now` を差し替えられるようにして
 * 境界値（ちょうど48時間前等）をテストで固定できるようにする。
 */
export function isWithinNewsWindow(publishedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - publishedAt.getTime() <= NEWS_SITEMAP_WINDOW_MS;
}

/** `<url>` 1件分（`<news:news>` 込み）を組み立てる。 */
function buildUrlBlock(article: NewsSitemapArticle, siteUrl: string, siteName: string): string {
  const loc = escapeXml(`${siteUrl}/articles/${article.slug}`);
  return `  <url>
    <loc>${loc}</loc>
    <news:news>
      <news:publication>
        <news:name>${escapeXml(siteName)}</news:name>
        <news:language>ja</news:language>
      </news:publication>
      <news:publication_date>${article.publishedAt.toISOString()}</news:publication_date>
      <news:title>${escapeXml(article.title)}</news:title>
    </news:news>
  </url>`;
}

/**
 * news sitemap 全体のXML文字列を組み立てる。`articles` は呼び出し側
 * （app/news-sitemap.xml/route.ts）が既に48時間以内・公開済みで絞り込んだものを渡す。
 * 対象が0件でも空の有効な urlset を返す（エラーにしない）。
 */
export function buildNewsSitemapXml(
  articles: NewsSitemapArticle[],
  siteUrl: string,
  siteName: string,
): string {
  const body = articles.length > 0 ? `\n${articles.map((a) => buildUrlBlock(a, siteUrl, siteName)).join("\n")}\n` : "\n";

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">${body}</urlset>`;
}
