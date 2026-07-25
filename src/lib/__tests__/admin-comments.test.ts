/**
 * 運営CMS（拡張E7）保留コメント管理の結合テスト。承認によるcommentCount整合・削除・
 * 未認証呼び出しの拒否を検証する。
 */
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { approveHeldComment, rejectHeldComment, listHeldCommentsForAdmin } from "@/lib/admin/comments-admin";
import { UnauthorizedError } from "@/lib/auth/basic-auth";
import type { AdminAuthContext } from "@/lib/admin/auth-context";

const UNAUTHORIZED: AdminAuthContext = { authorizationHeader: null };

function authorizedContext(): AdminAuthContext {
  const header = `Basic ${Buffer.from("test-admin:test-pass", "utf-8").toString("base64")}`;
  return { authorizationHeader: header };
}

async function resetDb() {
  await prisma.articleComment.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createArticleWithHeldComment(commentCount = 0) {
  const article = await prisma.article.create({
    data: {
      slug: `article-${Math.random().toString(36).slice(2)}`,
      title: "コメント対象記事",
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2026-07-20T00:00:00+09:00"),
      status: "published",
      commentCount,
    },
  });
  const comment = await prisma.articleComment.create({
    data: {
      articleId: article.id,
      number: 1,
      name: "太郎",
      body: "NGワードを含む本文",
      status: "held",
      heldReason: "ng_word",
    },
  });
  return { article, comment };
}

beforeEach(async () => {
  await resetDb();
});

describe("運営CMS 保留コメント管理（認可ゲート含む）", () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    process.env.ADMIN_USER = "test-admin";
    process.env.ADMIN_PASSWORD = "test-pass";
  });

  afterAll(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
  });

  it("未認証コンテキストではapproveHeldCommentがUnauthorizedErrorを投げ、DBを変更しない", async () => {
    const { comment } = await createArticleWithHeldComment(0);
    await expect(approveHeldComment(comment.id, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);

    const unchanged = await prisma.articleComment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(unchanged.status).toBe("held");
  });

  it("承認するとstatus=publishedになり、対象記事のcommentCountが1加算される", async () => {
    const { article, comment } = await createArticleWithHeldComment(3);
    await approveHeldComment(comment.id, authorizedContext());

    const updatedComment = await prisma.articleComment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(updatedComment.status).toBe("published");
    expect(updatedComment.heldReason).toBeNull();

    const updatedArticle = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updatedArticle.commentCount).toBe(4);
  });

  it("同一コメントを二重に承認してもcommentCountは1回しか加算されない", async () => {
    const { article, comment } = await createArticleWithHeldComment(0);
    await approveHeldComment(comment.id, authorizedContext());
    await approveHeldComment(comment.id, authorizedContext());

    const updatedArticle = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updatedArticle.commentCount).toBe(1);
  });

  it("却下するとコメントが削除され、保留一覧から消える", async () => {
    const { comment } = await createArticleWithHeldComment(0);
    await rejectHeldComment(comment.id, authorizedContext());

    const deleted = await prisma.articleComment.findUnique({ where: { id: comment.id } });
    expect(deleted).toBeNull();

    const held = await listHeldCommentsForAdmin();
    expect(held).toHaveLength(0);
  });

  it("未認証コンテキストではrejectHeldCommentも拒否される", async () => {
    const { comment } = await createArticleWithHeldComment(0);
    await expect(rejectHeldComment(comment.id, UNAUTHORIZED)).rejects.toThrow(UnauthorizedError);
  });

  it("listHeldCommentsForAdminは記事タイトル/slugを含めて保留コメントを返す", async () => {
    const { article, comment } = await createArticleWithHeldComment(0);
    const held = await listHeldCommentsForAdmin();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      id: comment.id,
      articleSlug: article.slug,
      articleTitle: article.title,
      heldReason: "ng_word",
    });
  });
});
