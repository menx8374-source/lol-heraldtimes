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
import { pickDeterministicChampionSplashUrl } from "@/lib/generation/champion-splash";
import { getSiteUrl } from "@/lib/site";

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

  it("用語集を含み、champions・tier・patches はsitemapから除外される（拡張E34b: 運用方針変更で導線・sitemapから削除）", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);

    expect(urls.some((u) => u.endsWith("/glossary"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/champions"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/patches"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/tier"))).toBe(false);
  });
});

describe("攻略・データ固定ページのメタ情報（拡張E6）", () => {
  it("チャンピオン詳細ページのタイトルはチャンピオンごとに異なる", async () => {
    const { generateMetadata } = await import("@/app/champions/[slug]/page");
    const metaGaren = await generateMetadata({ params: Promise.resolve({ slug: "garen" }) });
    const metaJinx = await generateMetadata({ params: Promise.resolve({ slug: "jinx" }) });
    expect(metaGaren.title).not.toBe(metaJinx.title);
    expect(metaGaren.title).toBeTruthy();
  });

  it("存在しないチャンピオンスラッグは専用タイトルを返す", async () => {
    const { generateMetadata } = await import("@/app/champions/[slug]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "no-such-champion" }) });
    expect(meta.title).toBe("チャンピオンが見つかりません");
  });

  it("パッチ詳細ページのタイトルはバージョンごとに異なる", async () => {
    const { generateMetadata } = await import("@/app/patches/[version]/page");
    const meta1 = await generateMetadata({ params: Promise.resolve({ version: "14-13" }) });
    const meta2 = await generateMetadata({ params: Promise.resolve({ version: "14-12" }) });
    expect(meta1.title).not.toBe(meta2.title);
  });

  it("チャンピオン一覧・Tier表・用語集・パッチ一覧はそれぞれ固有のタイトルを持つ", async () => {
    const { generateMetadata: champMeta } = await import("@/app/champions/page");
    const { metadata: tierMeta } = await import("@/app/tier/page");
    const { metadata: patchMeta } = await import("@/app/patches/page");
    const { generateMetadata: glossaryMeta } = await import("@/app/glossary/page");

    const titles = [
      (await champMeta({ searchParams: Promise.resolve({}) })).title,
      tierMeta.title,
      patchMeta.title,
      (await glossaryMeta({ searchParams: Promise.resolve({}) })).title,
    ];
    expect(new Set(titles).size).toBe(titles.length);
    for (const t of titles) {
      expect(t).toBeTruthy();
    }
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

describe("記事OG画像のフォールバック（拡張E38 テスト4: 反応記事サムネの表示側フォールバック）", () => {
  it("反応カテゴリ + thumbnailUrl未設定 → slugから決定論的に選んだチャンピオンスプラッシュの絶対URLになる", async () => {
    const meta = await generateArticleMetadata({
      params: Promise.resolve({ slug: "published-article-b" }), // category: 5chの反応, thumbnailUrl未設定
    });
    const expectedImage = pickDeterministicChampionSplashUrl("published-article-b");
    expect(meta.openGraph?.images).toEqual([{ url: expectedImage }]);
    expect(expectedImage).toMatch(/^https:\/\/ddragon\.leagueoflegends\.com\/.+_0\.jpg$/);
  });

  it("非反応カテゴリ + thumbnailUrl未設定 → 従来どおりサイト既定のOGP画像になる", async () => {
    const meta = await generateArticleMetadata({
      params: Promise.resolve({ slug: "published-article-a" }), // category: パッチ/メタ, thumbnailUrl未設定
    });
    const siteUrl = getSiteUrl();
    expect(meta.openGraph?.images).toEqual([{ url: `${siteUrl}/og-default.svg` }]);
  });

  it("thumbnailUrlが保存済みならカテゴリによらずそれを優先する（回帰なし）", async () => {
    await prisma.article.update({
      where: { slug: "published-article-b" },
      data: { thumbnailUrl: "https://example.com/saved-thumb.jpg" },
    });
    const meta = await generateArticleMetadata({
      params: Promise.resolve({ slug: "published-article-b" }),
    });
    expect(meta.openGraph?.images).toEqual([{ url: "https://example.com/saved-thumb.jpg" }]);
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
