/**
 * admincms-S5設計整理: `approveReviewArticleAction`（レビューキューの個別承認）が、承認後に
 * 一覧ページ群＋当該記事の個別詳細ページを同一プロセス内で直接`revalidatePath`すること
 * （`bulkApproveReviewArticlesAction`と対称な反映経路になっていること）を検証する。
 * HTTPループバック（機能B）は呼ばない設計になったため、fetchのモックは不要。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { approveReviewArticleAction } from "@/app/admin/actions";

const AUTH_HEADER = `Basic ${Buffer.from("test-admin:test-pass", "utf-8").toString("base64")}`;

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (key: string) => (key.toLowerCase() === "authorization" ? AUTH_HEADER : null),
  }),
}));
const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

async function resetDb() {
  await prisma.articleTag.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticle(status: string) {
  return prisma.article.create({
    data: {
      slug: `article-${Math.random().toString(36).slice(2)}`,
      title: "テスト記事",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status,
    },
  });
}

function formData(articleId: string): FormData {
  const fd = new FormData();
  fd.set("articleId", articleId);
  return fd;
}

describe("approveReviewArticleAction（レビューキューの個別承認、admincms-S5設計整理）", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(async () => {
    await resetDb();
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
    revalidatePathMock.mockClear();
  });

  afterAll(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("承認後、一覧ページ群＋当該記事の個別詳細ページをin-processでrevalidatePathする", async () => {
    const article = await createArticle("review");

    await approveReviewArticleAction(formData(article.id));

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.status).toBe("published");

    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    expect(revalidatePathMock).toHaveBeenCalledWith(`/articles/${article.slug}`);
    expect(revalidatePathMock).toHaveBeenCalledWith("/category/[slug]", "page");
    expect(revalidatePathMock).toHaveBeenCalledWith("/tags/[tag]", "page");
  });

  it("不正な状態遷移（review以外）では承認・再検証のいずれも行われない", async () => {
    const article = await createArticle("held");

    await expect(approveReviewArticleAction(formData(article.id))).rejects.toThrow();

    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.status).toBe("held");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
