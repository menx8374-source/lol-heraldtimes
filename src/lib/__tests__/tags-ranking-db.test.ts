/**
 * 人気タグ集計（拡張E4）のDB結合テスト。公開記事限定・記事数集計を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { listAllTagNames, listAllTagsWithCounts, listPopularTags } from "@/lib/tags";

async function resetDb() {
  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticleWithTags(slug: string, status: string, tagNames: string[]) {
  return prisma.article.create({
    data: {
      slug,
      title: `記事-${slug}`,
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status,
      tags: {
        create: tagNames.map((name) => ({
          tag: { connectOrCreate: { where: { name }, create: { name } } },
        })),
      },
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("listPopularTags（拡張E4）", () => {
  it("公開記事のみを対象にタグごとの記事数を数え、保留記事は数えない", async () => {
    await createArticleWithTags("a", "published", ["ヤスオ", "パッチ"]);
    await createArticleWithTags("b", "published", ["ヤスオ"]);
    await createArticleWithTags("c", "held", ["ヤスオ"]);

    const tags = await listPopularTags(10);
    const yasuo = tags.find((t) => t.name === "ヤスオ");
    const patch = tags.find((t) => t.name === "パッチ");
    expect(yasuo?.count).toBe(2);
    expect(patch?.count).toBe(1);
  });

  it("limitで上位件数に絞る", async () => {
    await createArticleWithTags("a", "published", ["タグ1", "タグ2", "タグ3"]);
    const tags = await listPopularTags(1);
    expect(tags).toHaveLength(1);
  });
});

describe("listAllTagsWithCounts（タグ一覧ページ用, 拡張E10）", () => {
  it("公開記事のみを対象に、記事数の多い順で全タグを返す（0件タグ・保留記事は除く）", async () => {
    await createArticleWithTags("a", "published", ["ヤスオ", "パッチ"]);
    await createArticleWithTags("b", "published", ["ヤスオ"]);
    await createArticleWithTags("c", "held", ["ゼド"]); // 公開記事が無いタグ

    const tags = await listAllTagsWithCounts();
    expect(tags).toEqual([
      { name: "ヤスオ", count: 2 },
      { name: "パッチ", count: 1 },
    ]);
  });

  it("タグが1件も無い場合は空配列を返す", async () => {
    expect(await listAllTagsWithCounts()).toEqual([]);
  });
});

describe("listAllTagNames（サイトマップ用, 拡張E4）", () => {
  it("公開記事が1件以上付いているタグ名のみを返す", async () => {
    await createArticleWithTags("a", "published", ["ヤスオ"]);
    await createArticleWithTags("b", "held", ["ゼド"]);

    const names = await listAllTagNames();
    expect(names).toContain("ヤスオ");
    expect(names).not.toContain("ゼド");
  });
});
