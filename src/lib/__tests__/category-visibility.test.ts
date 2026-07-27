/**
 * カテゴリの一覧導線への露出（リファクタリングS7a F-S7a-2）のテスト。
 * 純関数（filterVisibleCategories）と、専用テストDBへの結線（listVisibleCategoryLabels）の両方を検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  filterVisibleCategories,
  listCategoryLabelsWithPublishedArticles,
  listVisibleCategoryLabels,
} from "@/lib/category-visibility";
import { CATEGORY_LABELS } from "@/lib/categories";

describe("filterVisibleCategories（純関数）", () => {
  it("定義済みカテゴリのうち、記事があるカテゴリのみを定義順で返す", () => {
    const defined = ["パッチ/メタ", "Riot公式", "eスポーツ", "5chの反応", "海外の反応"] as const;
    const withArticles = ["5chの反応", "パッチ/メタ"];
    expect(filterVisibleCategories(defined, withArticles)).toEqual(["パッチ/メタ", "5chの反応"]);
  });

  it("記事があるカテゴリが1つも無ければ空配列を返す", () => {
    const defined = ["パッチ/メタ", "Riot公式"] as const;
    expect(filterVisibleCategories(defined, [])).toEqual([]);
  });

  it("記事がある一覧に定義されていないラベルが含まれていても無視する", () => {
    const defined = ["パッチ/メタ"] as const;
    expect(filterVisibleCategories(defined, ["存在しないカテゴリ", "パッチ/メタ"])).toEqual([
      "パッチ/メタ",
    ]);
  });
});

const body = [
  { type: "heading", text: "見出し" },
  { type: "paragraph", text: "テスト用の本文段落です。" },
];

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
}

describe("listCategoryLabelsWithPublishedArticles / listVisibleCategoryLabels（DB結線）", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("公開記事(published)のカテゴリのみを返し、保留(held)記事のカテゴリは含めない", async () => {
    await prisma.article.create({
      data: {
        slug: "s7a-visible-published",
        title: "公開記事",
        category: "パッチ/メタ",
        body,
        publishedAt: new Date(),
        status: "published",
        sources: { create: [{ label: "Riot公式", url: "https://example.com/s7a-a" }] },
      },
    });
    await prisma.article.create({
      data: {
        slug: "s7a-visible-held",
        title: "保留記事",
        category: "Riot公式",
        body,
        publishedAt: new Date(),
        status: "held",
        heldReason: "ng_word",
        sources: { create: [{ label: "Riot公式", url: "https://example.com/s7a-b" }] },
      },
    });

    const labels = await listCategoryLabelsWithPublishedArticles();
    expect(labels).toContain("パッチ/メタ");
    expect(labels).not.toContain("Riot公式");
  });

  it("記事が1件も無いカテゴリ(Riot公式・eスポーツ)は一覧導線から除外され、記事があるカテゴリのみ返る", async () => {
    await prisma.article.create({
      data: {
        slug: "s7a-visible-5ch",
        title: "5ch記事",
        category: "5chの反応",
        body,
        publishedAt: new Date(),
        status: "published",
        sources: { create: [{ label: "5ch", url: "https://example.com/s7a-c" }] },
      },
    });

    const visible = await listVisibleCategoryLabels();
    expect(visible).toContain("5chの反応");
    expect(visible).not.toContain("Riot公式");
    expect(visible).not.toContain("eスポーツ");
    // 定義順を保つ（CATEGORY_LABELSのsubsetであること）
    for (const label of visible) {
      expect(CATEGORY_LABELS).toContain(label);
    }
  });

  it("公開記事が1件もなければ空配列を返す", async () => {
    const visible = await listVisibleCategoryLabels();
    expect(visible).toEqual([]);
  });
});
