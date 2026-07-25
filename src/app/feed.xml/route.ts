/**
 * RSS 2.0 フィード（拡張E4）。直近の公開記事（保留記事は含めない）をタイトル・リンク・
 * 抜粋・公開日時付きで配信する。自動運営パイプラインが継続的に記事を公開するため、
 * sitemap.ts と同様に毎リクエストDBを再読込し（キャッシュ固定しない）鮮度を保つ。
 */
import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY, summarySelect, toSummary } from "@/lib/articles";
import { buildRssFeed } from "@/lib/feed";
import { getSiteUrl, articleUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const FEED_ITEM_LIMIT = 30;
const FEED_TITLE = "LoLまとめ速報";
const FEED_DESCRIPTION =
  "League of Legends（LoL）の海外・5chの反応やパッチノート・大会結果をまとめる速報サイト。";

export async function GET() {
  const siteUrl = getSiteUrl();

  const rows = await prisma.article.findMany({
    where: PUBLISHED_ONLY,
    select: summarySelect,
    orderBy: { publishedAt: "desc" },
    take: FEED_ITEM_LIMIT,
  });

  const items = rows.map((row) => {
    const summary = toSummary(row);
    return {
      title: summary.title,
      url: articleUrl(summary.slug),
      description: summary.excerpt,
      publishedAt: summary.publishedAt,
    };
  });

  const xml = buildRssFeed({
    siteUrl,
    title: FEED_TITLE,
    description: FEED_DESCRIPTION,
    items,
  });

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
