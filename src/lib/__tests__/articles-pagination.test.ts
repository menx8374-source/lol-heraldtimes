/**
 * 一覧系クエリのページネーション（拡張E1）の結合テスト。専用テストDBに実際に記事を投入し、
 * DB skip/take による区切り・総ページ数・範囲外ページのクランプ・0件時の扱いを検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { listArticles, listArticlesByCategory, listArticlesByTag } from "@/lib/articles";

async function resetDb() {
  await prisma.articleReaction.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function seedArticles(count: number, category = "パッチ/メタ") {
  for (let i = 0; i < count; i++) {
    await prisma.article.create({
      data: {
        slug: `pg-article-${category}-${i}`,
        title: `テスト記事${i}`,
        category,
        body: [{ type: "paragraph", text: "本文" }],
        publishedAt: new Date(Date.now() - i * 1000),
        status: "published",
      },
    });
  }
}

beforeEach(async () => {
  await resetDb();
});

describe("listArticles ページネーション", () => {
  it("指定ページサイズで区切り、総件数・総ページ数を正しく算出する", async () => {
    await seedArticles(25);

    const page1 = await listArticles(1, 20);
    expect(page1.items).toHaveLength(20);
    expect(page1.totalCount).toBe(25);
    expect(page1.totalPages).toBe(2);
    expect(page1.page).toBe(1);

    const page2 = await listArticles(2, 20);
    expect(page2.items).toHaveLength(5);
    expect(page2.page).toBe(2);
  });

  it("範囲外のページ番号は最終ページにクランプされる", async () => {
    await seedArticles(5);
    const result = await listArticles(99, 20);
    expect(result.page).toBe(1);
    expect(result.items).toHaveLength(5);
  });

  it("0件のときは空配列・総ページ数1・ページ1を返す", async () => {
    const result = await listArticles(1, 20);
    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
  });

  it("保留(held)記事はページネーション結果にも含めない", async () => {
    await seedArticles(3);
    await prisma.article.create({
      data: {
        slug: "held-in-pagination",
        title: "保留記事",
        category: "パッチ/メタ",
        body: [{ type: "paragraph", text: "本文" }],
        publishedAt: new Date(),
        status: "held",
        heldReason: "ng_word",
      },
    });
    const result = await listArticles(1, 20);
    expect(result.totalCount).toBe(3);
    expect(result.items.some((a) => a.slug === "held-in-pagination")).toBe(false);
  });
});

describe("listArticlesByCategory / listArticlesByTag ページネーション", () => {
  it("カテゴリ絞り込み後の件数でページングする", async () => {
    await seedArticles(22, "パッチ/メタ");
    await seedArticles(3, "5chの反応");

    const result = await listArticlesByCategory("パッチ/メタ", 1, 20);
    expect(result.totalCount).toBe(22);
    expect(result.totalPages).toBe(2);
    expect(result.items).toHaveLength(20);
  });

  it("タグ絞り込み後の件数でページングする", async () => {
    const article = await prisma.article.create({
      data: {
        slug: "tag-pg-article",
        title: "タグ記事",
        category: "パッチ/メタ",
        body: [{ type: "paragraph", text: "本文" }],
        publishedAt: new Date(),
        status: "published",
        tags: {
          create: [{ tag: { connectOrCreate: { where: { name: "ヤスオ" }, create: { name: "ヤスオ" } } } }],
        },
      },
    });

    const result = await listArticlesByTag("ヤスオ", 1, 20);
    expect(result.totalCount).toBe(1);
    expect(result.items[0].slug).toBe(article.slug);
  });
});
