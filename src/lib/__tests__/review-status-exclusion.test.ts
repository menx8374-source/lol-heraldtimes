/**
 * admincms-S1 不変条件テスト:「要レビュー(status=review)の記事は公開系クエリのいずれにも
 * 出てはならない」ことを、一覧・カテゴリ・タグ・検索・人気ランキング（累計/期間別）・
 * サイトマップ・ニュースサイトマップ・アーカイブ（月別/日別）・関連記事・個別記事取得の
 * 全経路について検証する（既存4状態=published/held/rejected/scheduledの挙動は変えない）。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listArticles,
  listArticlesByCategory,
  listArticlesByTag,
  listPopularArticles,
  listPopularArticlesByPeriod,
  listArticlesForSitemap,
  listArticlesForNewsSitemap,
  getArticleBySlug,
  listRelatedArticles,
} from "@/lib/articles";
import { searchArticles } from "@/lib/search";
import { listArticlesByMonth, listArticlesByDate } from "@/lib/archive";
import { listCategoryLabelsWithPublishedArticles } from "@/lib/category-visibility";

const CATEGORY = "パッチ/メタ";
const NOW = new Date("2026-07-30T12:00:00+09:00");

async function resetDb() {
  await prisma.articleView.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(overrides: Partial<Record<string, unknown>> = {}) {
  return prisma.article.create({
    data: {
      slug: (overrides.slug as string) ?? `article-${Math.random().toString(36).slice(2)}`,
      title: (overrides.title as string) ?? "レビュー除外検証タイトル",
      category: (overrides.category as string) ?? CATEGORY,
      body: (overrides.body as object) ?? [{ type: "paragraph", text: "レビュー除外検証の本文" }],
      publishedAt: (overrides.publishedAt as Date) ?? NOW,
      status: (overrides.status as string) ?? "review",
      viewCount: (overrides.viewCount as number) ?? 100,
      sources: { create: [{ label: "reddit", url: "https://reddit.com/r/leagueoflegends/x" }] },
      ...(overrides.tags
        ? { tags: { create: (overrides.tags as string[]).map((name) => ({ tag: { connectOrCreate: { where: { name }, create: { name } } } })) } }
        : {}),
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("要レビュー(review)記事が公開系クエリから漏れないこと", () => {
  it("listArticles（トップ一覧）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-1", status: "review" });
    await createArticle({ slug: "published-1", status: "published" });
    const list = await listArticles(1, 20);
    expect(list.items.map((a) => a.slug)).toEqual(["published-1"]);
  });

  it("listArticlesByCategory（カテゴリ一覧）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-cat", status: "review", category: CATEGORY });
    await createArticle({ slug: "published-cat", status: "published", category: CATEGORY });
    const list = await listArticlesByCategory(CATEGORY, 1, 20);
    expect(list.items.map((a) => a.slug)).toEqual(["published-cat"]);
  });

  it("listArticlesByTag（タグ一覧）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-tag", status: "review", tags: ["ヤスオ"] });
    await createArticle({ slug: "published-tag", status: "published", tags: ["ヤスオ"] });
    const list = await listArticlesByTag("ヤスオ", 1, 20);
    expect(list.items.map((a) => a.slug)).toEqual(["published-tag"]);
  });

  it("searchArticles（検索）はreview記事のタイトルにヒットしても結果に含まない", async () => {
    await createArticle({ slug: "review-search", status: "review", title: "検索ヒット確認用要レビュータイトル" });
    await createArticle({ slug: "published-search", status: "published", title: "検索ヒット確認用公開タイトル" });
    const result = await searchArticles("検索ヒット確認用");
    expect(result.items.map((a) => a.slug)).toEqual(["published-search"]);
  });

  it("listPopularArticles（累計人気）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-popular", status: "review", viewCount: 9999 });
    await createArticle({ slug: "published-popular", status: "published", viewCount: 1 });
    const popular = await listPopularArticles(10);
    expect(popular.map((a) => a.slug)).toEqual(["published-popular"]);
  });

  it("listPopularArticlesByPeriod（期間別人気）はreview記事の閲覧イベントを集計対象にしない", async () => {
    const reviewArticle = await createArticle({ slug: "review-period", status: "review" });
    const publishedArticle = await createArticle({ slug: "published-period", status: "published" });
    // listPopularArticlesByPeriodはcutoff計算にnew Date()（実行時の実時刻）を使うため、
    // 固定テスト日時(NOW)ではなく実際の現在時刻を使う。
    const viewedAt = new Date();
    await prisma.articleView.create({ data: { articleId: reviewArticle.id, viewedAt } });
    await prisma.articleView.create({ data: { articleId: publishedArticle.id, viewedAt } });

    const ranking = await listPopularArticlesByPeriod("day", 10);
    expect(ranking.map((a) => a.slug)).toEqual(["published-period"]);
  });

  it("listArticlesForSitemap（サイトマップ）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-sitemap", status: "review" });
    await createArticle({ slug: "published-sitemap", status: "published" });
    const sitemapArticles = await listArticlesForSitemap();
    expect(sitemapArticles.map((a) => a.slug)).toEqual(["published-sitemap"]);
  });

  it("listArticlesForNewsSitemap（ニュースサイトマップ）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-news-sitemap", status: "review", publishedAt: NOW });
    await createArticle({ slug: "published-news-sitemap", status: "published", publishedAt: NOW });
    const newsArticles = await listArticlesForNewsSitemap(NOW);
    expect(newsArticles.map((a) => a.slug)).toEqual(["published-news-sitemap"]);
  });

  it("getArticleBySlug（個別記事取得）はreview記事に対しnullを返す（呼び出し側は404にする）", async () => {
    await createArticle({ slug: "review-detail", status: "review" });
    expect(await getArticleBySlug("review-detail")).toBeNull();
  });

  it("listArticlesByMonth（月別アーカイブ）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-month", status: "review", publishedAt: NOW });
    await createArticle({ slug: "published-month", status: "published", publishedAt: NOW });
    const result = await listArticlesByMonth("2026-07", 1, 20);
    expect(result?.items.map((a) => a.slug)).toEqual(["published-month"]);
  });

  it("listArticlesByDate（日別アーカイブ）はreview記事を含まない", async () => {
    await createArticle({ slug: "review-date", status: "review", publishedAt: NOW });
    await createArticle({ slug: "published-date", status: "published", publishedAt: NOW });
    const result = await listArticlesByDate("2026-07-30", 1, 20);
    expect(result?.items.map((a) => a.slug)).toEqual(["published-date"]);
  });

  it("listCategoryLabelsWithPublishedArticles（カテゴリ露出判定）はreview記事のみのカテゴリを含まない", async () => {
    await createArticle({ slug: "review-only-category", status: "review", category: "eスポーツ" });
    const labels = await listCategoryLabelsWithPublishedArticles();
    expect(labels).not.toContain("eスポーツ");
  });

  it("listRelatedArticles（関連記事）はreview記事を候補に含まない", async () => {
    const current = await createArticle({ slug: "current-article", status: "published", category: CATEGORY });
    await createArticle({ slug: "review-related", status: "review", category: CATEGORY });
    await createArticle({ slug: "published-related", status: "published", category: CATEGORY });

    const currentDetail = await getArticleBySlug(current.slug);
    if (!currentDetail) throw new Error("テスト前提: current記事がpublishedのまま取得できるはず");
    const related = await listRelatedArticles(currentDetail, 5);
    expect(related.map((a) => a.slug)).not.toContain("review-related");
    expect(related.map((a) => a.slug)).toContain("published-related");
  });
});
