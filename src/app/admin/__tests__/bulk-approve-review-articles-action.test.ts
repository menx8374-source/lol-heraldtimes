/**
 * admincms-S5 F11: `bulkApproveReviewArticlesAction`（レビューキューの一括承認サーバーアクション）が、
 * 0件選択・一部失敗・全件成功のそれぞれで正しい集計と記事状態を返すことを検証する。
 * `next/headers`はVitest実行環境では使えないため、認可ヘッダーを固定値で返すようにモックする。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { bulkApproveReviewArticlesAction } from "@/app/admin/actions";

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

function formDataWithSelectedIds(ids: string[]): FormData {
  const fd = new FormData();
  for (const id of ids) fd.append("selectedIds", id);
  return fd;
}

describe("bulkApproveReviewArticlesAction（レビューキューの一括承認、admincms-S5 F11）", () => {
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

  it("0件選択時は「記事が選択されていません」相当の状態を返し、DBを変更せず再検証も呼ばない", async () => {
    const article = await createArticle("review");
    const result = await bulkApproveReviewArticlesAction({ status: "idle" }, formDataWithSelectedIds([]));

    expect(result).toEqual({ status: "no_selection" });
    const unchanged = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(unchanged.status).toBe("review");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("3件中2件選択すると、選択した2件だけpublishedになり、選択しなかった1件はreviewのまま残る", async () => {
    const a = await createArticle("review");
    const b = await createArticle("review");
    const c = await createArticle("review");

    const result = await bulkApproveReviewArticlesAction(
      { status: "idle" },
      formDataWithSelectedIds([a.id, b.id]),
    );

    expect(result).toEqual({ status: "done", succeededCount: 2, failed: [] });
    const updatedA = await prisma.article.findUniqueOrThrow({ where: { id: a.id } });
    const updatedB = await prisma.article.findUniqueOrThrow({ where: { id: b.id } });
    const untouchedC = await prisma.article.findUniqueOrThrow({ where: { id: c.id } });
    expect(updatedA.status).toBe("published");
    expect(updatedB.status).toBe("published");
    expect(untouchedC.status).toBe("review");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin");
    expect(revalidatePathMock).toHaveBeenCalledWith("/");
    // evaluatorフィードバック対応: 一括承認も個別承認と対称に、成功した各記事の個別詳細ページを
    // revalidatePathする（旧実装は一覧のみでdetailページを再検証していなかった）。
    expect(revalidatePathMock).toHaveBeenCalledWith(`/articles/${a.slug}`);
    expect(revalidatePathMock).toHaveBeenCalledWith(`/articles/${b.slug}`);
    expect(revalidatePathMock).not.toHaveBeenCalledWith(`/articles/${c.slug}`);
  });

  it("全件成功時も succeededCount に件数が返り（結果表示が消えないことのlibレベルの担保）、失敗は空", async () => {
    const a = await createArticle("review");
    const b = await createArticle("review");

    const result = await bulkApproveReviewArticlesAction(
      { status: "idle" },
      formDataWithSelectedIds([a.id, b.id]),
    );

    expect(result).toEqual({ status: "done", succeededCount: 2, failed: [] });
  });

  it("一部が不正な状態遷移で失敗しても、成功分は反映され失敗件数・理由が結果に含まれる", async () => {
    const reviewArticle = await createArticle("review");
    const heldArticle = await createArticle("held"); // status=reviewでないため承認は拒否される

    const result = await bulkApproveReviewArticlesAction(
      { status: "idle" },
      formDataWithSelectedIds([reviewArticle.id, heldArticle.id]),
    );

    expect(result.status).toBe("done");
    if (result.status === "done") {
      expect(result.succeededCount).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe(heldArticle.id);
    }
    const updatedReview = await prisma.article.findUniqueOrThrow({ where: { id: reviewArticle.id } });
    const unchangedHeld = await prisma.article.findUniqueOrThrow({ where: { id: heldArticle.id } });
    expect(updatedReview.status).toBe("published");
    expect(unchangedHeld.status).toBe("held");
  });
});
