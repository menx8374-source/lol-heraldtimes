/**
 * 運営CMS（拡張E7）: 保留コメント（ArticleComment.status="held"）の一覧・承認・却下の永続化ロジック。
 * approve/reject はいずれも `AdminAuthContext` を受け取り、最初に認可チェックする。
 */
import { prisma } from "@/lib/prisma";
import { requireAuthorized, type AdminAuthContext } from "@/lib/admin/auth-context";

export type HeldCommentForAdmin = {
  id: string;
  articleId: string;
  articleSlug: string;
  articleTitle: string;
  number: number;
  name: string;
  body: string;
  heldReason: string | null;
  createdAt: Date;
};

const HELD_COMMENTS_TAKE = 50;

/** 保留コメント一覧（新しい順）。件数はダッシュボードで無界表示にならないよう有界化する。 */
export async function listHeldCommentsForAdmin(limit = HELD_COMMENTS_TAKE): Promise<HeldCommentForAdmin[]> {
  const rows = await prisma.articleComment.findMany({
    where: { status: "held" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      articleId: true,
      number: true,
      name: true,
      body: true,
      heldReason: true,
      createdAt: true,
      article: { select: { slug: true, title: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    articleId: r.articleId,
    articleSlug: r.article.slug,
    articleTitle: r.article.title,
    number: r.number,
    name: r.name,
    body: r.body,
    heldReason: r.heldReason,
    createdAt: r.createdAt,
  }));
}

/**
 * 保留コメントを承認して公開する（status=published）。対象記事の commentCount を1加算する。
 * 既に published へ遷移済み（二重送信等）の場合は何もしない（updateManyのwhereでstatus=heldを
 * 条件に含めることで、加算だけが二重に走ることを防ぐ）。
 */
export async function approveHeldComment(commentId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.articleComment.updateMany({
      where: { id: commentId, status: "held" },
      data: { status: "published", heldReason: null },
    });
    if (updated.count === 0) return;

    const comment = await tx.articleComment.findUniqueOrThrow({ where: { id: commentId } });
    await tx.article.update({
      where: { id: comment.articleId },
      data: { commentCount: { increment: 1 } },
    });
  });
}

/** 保留コメントを却下する（削除。commentCountは元々加算されていないため触らない）。 */
export async function rejectHeldComment(commentId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  await prisma.articleComment.deleteMany({ where: { id: commentId, status: "held" } });
}
