import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

/**
 * robots（F13）。公開記事・カテゴリ等の閲覧ページはクロールを許可し、
 * 運営監視ダッシュボード（`/admin`。Sprint 9 で実装、公開サイトのナビゲーションからは
 * 辿れない）や内部APIルート `/api` は収集・公開対象外としてクロールから除外する。
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/dashboard", "/api/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
