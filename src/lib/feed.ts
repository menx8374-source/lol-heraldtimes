/**
 * RSS 2.0 フィード（拡張E4）の組み立てを担う純関数群。DB非依存にし、XMLエスケープを含めて
 * テストで検証できるようにする（app/feed.xml/route.ts から DB取得結果を渡して呼ぶ）。
 */

/**
 * XML本文用のエスケープ。`toSafeJsonLd`（JSON-LD の `<script>` 早期終了対策）とは別物で、
 * XML の予約文字（`&` `<` `>` `"` `'`）すべてを実体参照に置き換える必要がある
 * （記事タイトル・本文抜粋は掲示板由来のテキストで、これらの文字が混入し得る）。
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type FeedItem = {
  title: string;
  url: string;
  description: string;
  publishedAt: Date;
};

/** RSS 2.0 の `<item>` 1件分を組み立てる。 */
function buildItemXml(item: FeedItem): string {
  const link = escapeXml(item.url);
  return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
    </item>`;
}

/**
 * RSS 2.0 フィード全体のXML文字列を組み立てる。公開記事のみを含める前提で
 * `items` は呼び出し側（app/feed.xml/route.ts）が既に PUBLISHED_ONLY で絞り込んだものを渡す。
 */
export function buildRssFeed(params: {
  siteUrl: string;
  title: string;
  description: string;
  items: FeedItem[];
}): string {
  const { siteUrl, title, description, items } = params;
  const itemsXml = items.map(buildItemXml).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2000/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(siteUrl)}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml(description)}</description>
    <language>ja</language>
${itemsXml}
  </channel>
</rss>`;
}
