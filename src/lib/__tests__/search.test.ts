import { describe, expect, it, beforeEach } from "vitest";
import { bodyBlocksToText, matchesQuery, searchArticles } from "@/lib/search";
import { prisma } from "@/lib/prisma";
import type { ArticleBodyBlock } from "@/lib/article-body";

describe("bodyBlocksToText", () => {
  it("見出し・段落・引用の text を連結する", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "本文だよ" },
      { type: "quote", text: "引用だよ", source: "Reddit" },
    ];
    expect(bodyBlocksToText(blocks)).toBe("見出し 本文だよ 引用だよ");
  });
});

describe("matchesQuery", () => {
  it("タイトルに含まれるキーワードでヒットする", () => {
    expect(matchesQuery("ヤスオOTPの伝説的プレイ", "本文", "ヤスオ")).toBe(true);
  });

  it("本文に含まれるキーワードでヒットする（タイトルには含まれない）", () => {
    expect(matchesQuery("パッチ14.6の変更点", "ジャングル弱体化が話題", "ジャングル")).toBe(true);
  });

  it("日本語カタカナ語（チャンピオン名）でヒットする", () => {
    expect(matchesQuery("最新Tierリスト解説", "本文", "Tierリスト")).toBe(true);
  });

  it("一致しない場合は false", () => {
    expect(matchesQuery("タイトル", "本文", "ゼド")).toBe(false);
  });

  it("英字の大文字小文字を無視して一致する", () => {
    expect(matchesQuery("ADC build guide", "本文", "adc")).toBe(true);
  });

  it("空白のみのクエリは false（未検索と区別するため呼び出し側でも空扱いにする）", () => {
    expect(matchesQuery("タイトル", "本文", "   ")).toBe(false);
  });
});

describe("searchArticles ページネーション（拡張E1、結合テスト）", () => {
  async function resetDb() {
    await prisma.articleReaction.deleteMany();
    await prisma.articleTag.deleteMany();
    await prisma.articleSource.deleteMany();
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
  }

  beforeEach(async () => {
    await resetDb();
    for (let i = 0; i < 25; i++) {
      await prisma.article.create({
        data: {
          slug: `search-pg-${i}`,
          title: `ヤスオ神プレイ集${i}`,
          category: "5chの反応",
          body: [{ type: "paragraph", text: "本文" }],
          publishedAt: new Date(Date.now() - i * 1000),
          status: "published",
        },
      });
    }
  });

  it("一致件数をページ単位で区切って返す", async () => {
    const page1 = await searchArticles("ヤスオ", 1, 20);
    expect(page1.totalCount).toBe(25);
    expect(page1.totalPages).toBe(2);
    expect(page1.items).toHaveLength(20);

    const page2 = await searchArticles("ヤスオ", 2, 20);
    expect(page2.items).toHaveLength(5);
  });

  it("空クエリは1ページ目・空配列を返す", async () => {
    const result = await searchArticles("", 1, 20);
    expect(result.items).toEqual([]);
    expect(result.totalPages).toBe(1);
  });
});
