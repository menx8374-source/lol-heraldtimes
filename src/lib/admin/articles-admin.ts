/**
 * 運営CMS（拡張E7）: 記事の承認/却下・編集・ピン留め・予約公開設定の永続化ロジック。
 * すべての関数は `AdminAuthContext` を受け取り、最初に `requireAuthorized` で認可チェックする
 * （未認証呼び出しは UnauthorizedError を投げてDBを一切変更しない）。
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";
import { bodyBlocksToText } from "@/lib/search";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { requireAuthorized, type AdminAuthContext } from "@/lib/admin/auth-context";

export type AdminArticleSummary = {
  id: string;
  slug: string;
  title: string;
  status: string;
  pinned: boolean;
  scheduledAt: Date | null;
  publishedAt: Date;
  heldReason: string | null;
  heldDetail: string | null;
};

const ADMIN_LIST_TAKE = 30;

/** 運営CMSの「記事管理」一覧（編集/ピン留め/予約公開の対象選択用）。更新が新しい順。 */
export async function listArticlesForAdmin(options: { take?: number } = {}): Promise<AdminArticleSummary[]> {
  return prisma.article.findMany({
    orderBy: { updatedAt: "desc" },
    take: options.take ?? ADMIN_LIST_TAKE,
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      pinned: true,
      scheduledAt: true,
      publishedAt: true,
      heldReason: true,
      heldDetail: true,
    },
  });
}

export type AdminArticleEditData = {
  id: string;
  title: string;
  bodyText: string;
};

/** 編集フォーム用: 記事のタイトルと本文(整形済みJSONテキスト)を取得する。 */
export async function getArticleForEdit(articleId: string): Promise<AdminArticleEditData | null> {
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { id: true, title: true, body: true } });
  if (!article) return null;
  return { id: article.id, title: article.title, bodyText: JSON.stringify(article.body, null, 2) };
}

/** 保留記事を承認して公開する（status=published, publishedAt更新）。予約設定が残っていれば解除する。 */
export async function approveHeldArticle(articleId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  await prisma.article.update({
    where: { id: articleId },
    data: {
      status: "published",
      publishedAt: new Date(),
      heldReason: null,
      heldDetail: null,
      scheduledAt: null,
    },
  });
}

/** 保留記事を却下する。ハード削除ではなく status="rejected" にする（出典URLは残るため、同一話題の再生成も防げる）。 */
export async function rejectHeldArticle(articleId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  await prisma.article.update({
    where: { id: articleId },
    data: { status: "rejected" },
  });
}

/**
 * 記事のタイトル・本文を編集する。編集後の内容は安全フィルタ（NGワード/出典欠落/個人中傷）を再チェックし、
 * 「公開中の記事だったが編集後は不合格」なら保留(held)へ落として公開の不変条件を守る
 * （held/rejected/scheduled だった記事はそのまま編集内容のみ反映し、状態は変えない＝編集で勝手に公開しない）。
 */
export async function updateArticleContent(
  articleId: string,
  input: { title: string; bodyText: string },
  auth: AdminAuthContext,
): Promise<void> {
  requireAuthorized(auth);

  const title = input.title.trim();
  if (!title) throw new Error("タイトルは必須です");

  let body: ArticleBodyBlock[];
  try {
    body = parseArticleBody(JSON.parse(input.bodyText));
  } catch (err) {
    throw new Error(`本文の形式が不正です: ${err instanceof Error ? err.message : String(err)}`);
  }

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { sources: true },
  });
  if (!article) throw new Error("記事が見つかりません");

  const bodyText = bodyBlocksToText(body);
  const moderation = moderateArticleContent({ title, bodyText, sourceCount: article.sources.length });

  const data: Prisma.ArticleUpdateInput = { title, body };
  if (article.status === "published" && moderation.status !== "published") {
    data.status = "held";
    data.heldReason = moderation.reason;
    data.heldDetail = moderation.detail;
  }
  if (moderation.status === "published") {
    data.unconfirmed = moderation.unconfirmed;
  }

  await prisma.article.update({ where: { id: articleId }, data });
}

/** ピン留め(注目記事固定)のON/OFFを切り替える。 */
export async function toggleArticlePinned(articleId: string, pinned: boolean, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  await prisma.article.update({ where: { id: articleId }, data: { pinned } });
}

/** 予約公開時刻を設定する（status=scheduled）。到来判定・昇格は lib/generation/scheduled-publish.ts が担う。 */
export async function scheduleArticlePublish(
  articleId: string,
  scheduledAt: Date,
  auth: AdminAuthContext,
): Promise<void> {
  requireAuthorized(auth);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error("予約日時が不正です");
  }
  await prisma.article.update({
    where: { id: articleId },
    data: { status: "scheduled", scheduledAt, heldReason: null, heldDetail: null },
  });
}

/** 予約設定を解除し、保留(held)へ戻す（誤設定の取り消し用）。 */
export async function cancelScheduledPublish(articleId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  await prisma.article.update({
    where: { id: articleId },
    data: { status: "held", scheduledAt: null },
  });
}
