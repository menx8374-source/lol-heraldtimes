/**
 * 月別アーカイブ（拡張E4）のDB結合テスト。公開記事限定の月別集計・月指定一覧を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { listArchiveMonths, listArticlesByMonth } from "@/lib/archive";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(slug: string, publishedAt: Date, status = "published") {
  return prisma.article.create({
    data: {
      slug,
      title: `記事-${slug}`,
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt,
      status,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("listArchiveMonths（拡張E4）", () => {
  it("公開記事のみを月別に集計し、保留記事は含めない", async () => {
    await createArticle("a", new Date("2026-07-05T12:00:00+09:00"));
    await createArticle("b", new Date("2026-07-20T12:00:00+09:00"));
    await createArticle("c", new Date("2026-06-01T12:00:00+09:00"));
    await createArticle("held", new Date("2026-07-10T12:00:00+09:00"), "held");

    const months = await listArchiveMonths();
    const july = months.find((m) => m.key === "2026-07");
    const june = months.find((m) => m.key === "2026-06");
    expect(july?.count).toBe(2);
    expect(june?.count).toBe(1);
  });
});

describe("listArticlesByMonth（拡張E4）", () => {
  it("指定月の公開記事のみをページ単位で返す（他月・保留記事は含めない）", async () => {
    await createArticle("in-month", new Date("2026-07-15T12:00:00+09:00"));
    await createArticle("other-month", new Date("2026-06-15T12:00:00+09:00"));
    await createArticle("held-in-month", new Date("2026-07-16T12:00:00+09:00"), "held");

    const result = await listArticlesByMonth("2026-07");
    expect(result).not.toBeNull();
    expect(result!.items.map((a) => a.slug)).toEqual(["in-month"]);
  });

  it("該当月に記事が0件でも null にはならず空のページ結果を返す", async () => {
    const result = await listArticlesByMonth("2099-01");
    expect(result).not.toBeNull();
    expect(result!.items).toEqual([]);
    expect(result!.totalCount).toBe(0);
  });

  it("不正な月キーは null を返す", async () => {
    const result = await listArticlesByMonth("invalid");
    expect(result).toBeNull();
  });
});
