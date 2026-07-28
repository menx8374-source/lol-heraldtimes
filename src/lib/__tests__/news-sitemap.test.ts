/**
 * news sitemap（成長G5 F-G5-3）の純関数（lib/news-sitemap.ts）のユニットテスト。
 * ブリーフ テスト4: 48時間フィルタ・news名前空間・publication/language/publication_date/title・
 * 特殊文字エスケープ・対象0件で空urlset・48時間より古い記事の除外を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  NEWS_SITEMAP_WINDOW_MS,
  buildNewsSitemapXml,
  isWithinNewsWindow,
} from "@/lib/news-sitemap";

const SITE_URL = "https://example.com";
const SITE_NAME = "テストサイト";

describe("isWithinNewsWindow（48時間フィルタ）", () => {
  const now = new Date("2026-07-28T12:00:00Z");

  it("公開直後の記事はtrue", () => {
    expect(isWithinNewsWindow(now, now)).toBe(true);
  });

  it("ちょうど48時間前はtrue（境界値、以内）", () => {
    const publishedAt = new Date(now.getTime() - NEWS_SITEMAP_WINDOW_MS);
    expect(isWithinNewsWindow(publishedAt, now)).toBe(true);
  });

  it("48時間より1ミリ秒でも古い記事はfalse", () => {
    const publishedAt = new Date(now.getTime() - NEWS_SITEMAP_WINDOW_MS - 1);
    expect(isWithinNewsWindow(publishedAt, now)).toBe(false);
  });

  it("1週間前の記事はfalse", () => {
    const publishedAt = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(isWithinNewsWindow(publishedAt, now)).toBe(false);
  });
});

describe("buildNewsSitemapXml", () => {
  it("news名前空間を宣言し、publication/language/publication_date/titleを含む有効なXMLを返す", () => {
    const xml = buildNewsSitemapXml(
      [
        {
          slug: "test-article",
          title: "テスト記事タイトル",
          publishedAt: new Date("2026-07-27T10:00:00Z"),
        },
      ],
      SITE_URL,
      SITE_NAME,
    );

    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).toContain("<urlset");
    expect(xml).toContain(`<loc>${SITE_URL}/articles/test-article</loc>`);
    expect(xml).toContain(`<news:name>${SITE_NAME}</news:name>`);
    expect(xml).toContain("<news:language>ja</news:language>");
    expect(xml).toContain("<news:publication_date>2026-07-27T10:00:00.000Z</news:publication_date>");
    expect(xml).toContain("<news:title>テスト記事タイトル</news:title>");
  });

  it("対象記事が0件でも空の有効なurlsetを返す（エラーにしない）", () => {
    const xml = buildNewsSitemapXml([], SITE_URL, SITE_NAME);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
    expect(xml).not.toContain("<news:news>");
  });

  it("タイトル・URLの特殊文字(&, <, >, \", ')を必ずエスケープする", () => {
    const xml = buildNewsSitemapXml(
      [
        {
          slug: "special-chars",
          title: `<script>alert("1")</script> & 'quote' <tag>`,
          publishedAt: new Date("2026-07-27T10:00:00Z"),
        },
      ],
      SITE_URL,
      SITE_NAME,
    );

    expect(xml).not.toContain("<script>");
    expect(xml).not.toContain("</script>");
    expect(xml).toContain("&lt;script&gt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&apos;quote&apos;");
    expect(xml).toContain("&quot;1&quot;");
  });

  it("複数記事は公開日時降順の入力順どおりにurlブロックを並べる", () => {
    const xml = buildNewsSitemapXml(
      [
        { slug: "a", title: "記事A", publishedAt: new Date("2026-07-27T12:00:00Z") },
        { slug: "b", title: "記事B", publishedAt: new Date("2026-07-27T10:00:00Z") },
      ],
      SITE_URL,
      SITE_NAME,
    );
    const indexA = xml.indexOf("articles/a");
    const indexB = xml.indexOf("articles/b");
    expect(indexA).toBeGreaterThan(-1);
    expect(indexB).toBeGreaterThan(-1);
    expect(indexA).toBeLessThan(indexB);
  });
});
