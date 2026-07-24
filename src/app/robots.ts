import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

/**
 * robots（F13）。公開記事・カテゴリ等の閲覧ページはクロールを許可し、
 * 管理／保留キュー領域（Sprint 9 で追加予定の運営ダッシュボード `/admin` 等）や
 * 内部APIルート `/api` は収集・公開対象外としてクロールから除外する。
 * ダッシュボードの実パスが確定した際は、この Disallow 一覧を合わせて見直すこと。
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
