/**
 * F13（SEO・サイトマップ・robots）の結合テスト。専用テストDB（vitest.global-setup.ts で
 * DATABASE_URL を差し替え済み）に実際に記事を投入し、公開記事のみがサイトマップに載ること、
 * robots が管理領域を除外していること、各ページのタイトルがページごとに固有であることを検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { GET as getFeed } from "@/app/feed.xml/route";
import { generateMetadata as generateArticleMetadata } from "@/app/articles/[slug]/page";
import { generateMetadata as generateCategoryMetadata } from "@/app/category/[slug]/page";
import { metadata as rootMetadata } from "@/app/layout";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

const body = [
  { type: "heading", text: "見出し" },
  { type: "paragraph", text: "テスト用の本文段落です。" },
];

beforeEach(async () => {
  await resetDb();
  await prisma.article.create({
    data: {
      slug: "published-article-a",
      title: "公開記事A",
      category: "パッチ/メタ",
      body,
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: "published",
      sources: { create: [{ label: "Riot公式", url: "https://example.com/a" }] },
      tags: {
        create: [{ tag: { connectOrCreate: { where: { name: "ヤスオ" }, create: { name: "ヤスオ" } } } }],
      },
    },
  });
  await prisma.article.create({
    data: {
      slug: "published-article-b",
      title: "公開記事B",
      category: "5chの反応",
      body,
      publishedAt: new Date("2026-07-21T00:00:00+09:00"),
      status: "published",
      sources: { create: [{ label: "5ch", url: "https://example.com/b" }] },
    },
  });
  await prisma.article.create({
    data: {
      slug: "held-article-hidden",
      title: "保留中の記事",
      category: "パッチ/メタ",
      body,
      publishedAt: new Date("2026-07-22T00:00:00+09:00"),
      status: "held",
      heldReason: "ng_word",
      sources: { create: [{ label: "5ch", url: "https://example.com/c" }] },
    },
  });
});

describe("sitemap（F13）", () => {
  it("公開記事のみを列挙し、保留(held)記事は含めない", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls.some((u) => u.endsWith("/articles/published-article-a"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/articles/published-article-b"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/articles/held-article-hidden"))).toBe(false);
  });

  it("全カテゴリページとトップページを含む", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls.some((u) => u.endsWith("/category/patch-meta"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/category/5ch"))).toBe(true);
    expect(urls.some((u) => /^https?:\/\/[^/]+\/?$/.test(u))).toBe(true);
  });

  it("公開記事に付いたタグのページと月別アーカイブページを含む（拡張E4）", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls.some((u) => u.endsWith(`/tags/${encodeURIComponent("ヤスオ")}`))).toBe(true);
    expect(urls.some((u) => u.endsWith("/archive"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/archive/2026-07"))).toBe(true);
  });
});

describe("robots（F13）", () => {
  it("管理／保留キュー等の領域をクロール対象から除外する", () => {
    const result = robots();
    const disallow = Array.isArray(result.rules)
      ? result.rules.flatMap((r) => (Array.isArray(r.disallow) ? r.disallow : [r.disallow]))
      : Array.isArray(result.rules.disallow)
        ? result.rules.disallow
        : [result.rules.disallow];

    expect(disallow).toContain("/admin");
    expect(disallow).toContain("/dashboard");
  });

  it("公開ページのクロールは許可し、sitemapのURLを提供する", () => {
    const result = robots();
    const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rule.allow).toBe("/");
    expect(result.sitemap).toContain("/sitemap.xml");
  });
});

describe("ページごとのタイトル固有性（F13）", () => {
  it("記事ページのタイトルは記事ごとに異なる（ハードコードされた固定文字列ではない）", async () => {
    const metaA = await generateArticleMetadata({
      params: Promise.resolve({ slug: "published-article-a" }),
    });
    const metaB = await generateArticleMetadata({
      params: Promise.resolve({ slug: "published-article-b" }),
    });

    expect(metaA.title).toBe("公開記事A");
    expect(metaB.title).toBe("公開記事B");
    expect(metaA.title).not.toBe(metaB.title);
  });

  it("カテゴリページのタイトルはカテゴリごとに異なる", async () => {
    const metaPatch = await generateCategoryMetadata({
      params: Promise.resolve({ slug: "patch-meta" }),
    });
    const meta5ch = await generateCategoryMetadata({
      params: Promise.resolve({ slug: "5ch" }),
    });

    expect(metaPatch.title).not.toBe(meta5ch.title);
  });

  it("トップページの既定タイトルは記事・カテゴリページのタイトルと重複しない固定値を持つ", async () => {
    const metaArticle = await generateArticleMetadata({
      params: Promise.resolve({ slug: "published-article-a" }),
    });
    const rootTitle =
      typeof rootMetadata.title === "object" && rootMetadata.title !== null && "default" in rootMetadata.title
        ? rootMetadata.title.default
        : rootMetadata.title;

    expect(rootTitle).toBeTruthy();
    expect(rootTitle).not.toBe(metaArticle.title);
  });
});

describe("feed.xml（RSSフィード, 拡張E4）", () => {
  it("公開記事のみを含み、保留記事のタイトルは含めない", async () => {
    const res = await getFeed();
    expect(res.headers.get("Content-Type")).toContain("application/rss+xml");

    const xml = await res.text();
    expect(xml).toContain("<title>公開記事A</title>");
    expect(xml).toContain("<title>公開記事B</title>");
    expect(xml).not.toContain("保留中の記事");
    expect(xml).toContain("/articles/published-article-a");
    expect(xml).not.toContain("/articles/held-article-hidden");
  });

  it("新しい記事が先に並ぶ（publishedAt降順）", async () => {
    const res = await getFeed();
    const xml = await res.text();
    const indexB = xml.indexOf("公開記事B"); // publishedAtが新しい
    const indexA = xml.indexOf("公開記事A");
    expect(indexB).toBeGreaterThan(-1);
    expect(indexA).toBeGreaterThan(-1);
    expect(indexB).toBeLessThan(indexA);
  });
});
