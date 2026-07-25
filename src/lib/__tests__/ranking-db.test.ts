/**
 * 期間別人気記事ランキング（拡張E4）のDB結合テスト。ArticleView集計のcutoff境界・
 * 公開記事限定・閲覧イベント記録（incrementViewCount）を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { incrementViewCount, listPopularArticlesByPeriod } from "@/lib/articles";

async function resetDb() {
  await prisma.articleView.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(overrides: Partial<{ slug: string; status: string }> = {}) {
  return prisma.article.create({
    data: {
      slug: overrides.slug ?? "ranking-article",
      title: "ランキング対象記事",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: overrides.status ?? "published",
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("listPopularArticlesByPeriod（拡張E4）", () => {
  it("cutoff内の閲覧イベントのみを集計し、多い順に返す", async () => {
    const articleA = await createArticle({ slug: "article-a" });
    const articleB = await createArticle({ slug: "article-b" });

    const now = new Date();
    const recent = new Date(now.getTime() - 1000 * 60 * 60); // 1時間前
    const old = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 40); // 40日前（day/week/monthいずれのcutoff外）

    // articleA: 直近1件 + cutoff外2件 → 各期間の集計では1件のみ有効
    await prisma.articleView.create({ data: { articleId: articleA.id, viewedAt: recent } });
    await prisma.articleView.create({ data: { articleId: articleA.id, viewedAt: old } });
    await prisma.articleView.create({ data: { articleId: articleA.id, viewedAt: old } });

    // articleB: 直近2件
    await prisma.articleView.create({ data: { articleId: articleB.id, viewedAt: recent } });
    await prisma.articleView.create({ data: { articleId: articleB.id, viewedAt: recent } });

    const dayRanking = await listPopularArticlesByPeriod("day", 5);
    expect(dayRanking.map((a) => a.slug)).toEqual(["article-b", "article-a"]);
  });

  it("保留(held)記事の閲覧イベントは集計対象から除外する", async () => {
    const held = await createArticle({ slug: "held-article", status: "held" });
    await prisma.articleView.create({ data: { articleId: held.id } });

    const ranking = await listPopularArticlesByPeriod("day", 5);
    expect(ranking).toEqual([]);
  });

  it("該当期間に閲覧イベントが無ければ空配列を返す", async () => {
    await createArticle();
    const ranking = await listPopularArticlesByPeriod("month", 5);
    expect(ranking).toEqual([]);
  });

  it("limitで上位件数に絞る", async () => {
    const now = new Date();
    for (const slug of ["a", "b", "c"]) {
      const article = await createArticle({ slug });
      await prisma.articleView.create({ data: { articleId: article.id, viewedAt: now } });
    }
    const ranking = await listPopularArticlesByPeriod("day", 2);
    expect(ranking).toHaveLength(2);
  });
});

describe("incrementViewCount（拡張E4: 閲覧イベント記録）", () => {
  it("viewCountを1加算し、ArticleViewを1件記録する", async () => {
    const article = await createArticle();
    await incrementViewCount(article.slug);

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.viewCount).toBe(1);

    const views = await prisma.articleView.findMany({ where: { articleId: article.id } });
    expect(views).toHaveLength(1);
  });

  it("複数回の閲覧で件数分のArticleViewが記録される", async () => {
    const article = await createArticle();
    await incrementViewCount(article.slug);
    await incrementViewCount(article.slug);
    await incrementViewCount(article.slug);

    const views = await prisma.articleView.findMany({ where: { articleId: article.id } });
    expect(views).toHaveLength(3);
  });
});
