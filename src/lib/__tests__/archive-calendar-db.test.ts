/**
 * カレンダー式アーカイブ（拡張E10）のDB結合テスト。公開記事限定の日別一覧・日別件数集計を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { dayCountsForMonth, listArticlesByDate } from "@/lib/archive";

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

describe("listArticlesByDate（拡張E10）", () => {
  it("JSTの当日境界で公開記事のみを返す（保留記事・他日は含めない）", async () => {
    // UTC 2026-07-24T15:30:00Z = JST 2026-07-25 00:30（当日に含まれる）
    await createArticle("just-after-midnight-jst", new Date("2026-07-24T15:30:00Z"));
    // UTC 2026-07-24T14:00:00Z = JST 2026-07-24 23:00（前日扱い、含めない）
    await createArticle("previous-day-jst", new Date("2026-07-24T14:00:00Z"));
    await createArticle("held-in-day", new Date("2026-07-25T03:00:00Z"), "held");

    const result = await listArticlesByDate("2026-07-25");
    expect(result).not.toBeNull();
    expect(result!.items.map((a) => a.slug)).toEqual(["just-after-midnight-jst"]);
  });

  it("記事の無い日・未来日はエラーにならず空一覧を返す", async () => {
    const result = await listArticlesByDate("2099-01-01");
    expect(result).not.toBeNull();
    expect(result!.items).toEqual([]);
    expect(result!.totalCount).toBe(0);
  });

  it("不正な日付キーはnullを返す", async () => {
    expect(await listArticlesByDate("2026-02-30")).toBeNull();
    expect(await listArticlesByDate("invalid")).toBeNull();
  });
});

describe("dayCountsForMonth（拡張E10）", () => {
  it("対象月の公開記事のみをJST暦日ごとに集計する（保留記事・他月は含めない）", async () => {
    await createArticle("a", new Date("2026-07-05T03:00:00Z")); // JST 2026-07-05 12:00
    await createArticle("b", new Date("2026-07-05T05:00:00Z")); // JST 2026-07-05 14:00
    await createArticle("c", new Date("2026-06-30T15:30:00Z")); // JST 2026-07-01 00:30
    await createArticle("held", new Date("2026-07-05T06:00:00Z"), "held");
    await createArticle("other-month", new Date("2026-08-01T03:00:00Z"));

    const counts = await dayCountsForMonth("2026-07");
    expect(counts.get("2026-07-05")).toBe(2);
    expect(counts.get("2026-07-01")).toBe(1);
    expect(counts.has("2026-08-01")).toBe(false);
  });

  it("不正な月キーは空マップを返す", async () => {
    const counts = await dayCountsForMonth("invalid");
    expect(counts.size).toBe(0);
  });
});
