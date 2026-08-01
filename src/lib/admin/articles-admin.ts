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
import { revalidatePublishedListings } from "@/lib/generation/revalidate-listings";

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

export type ReviewQueueArticleSummary = {
  id: string;
  slug: string;
  title: string;
  category: string;
  createdAt: Date;
  /** 出典リンク（先頭1件）。出典が無い記事は null（安全フィルタの出典欠落チェックにより通常発生しない）。 */
  sourceUrl: string | null;
};

/**
 * レビューキュー（admincms-S1 F2）: status="review" の記事を新しい順で取得する。
 * take を指定すると DB 側で件数を絞る（未承認が積み上がっても無界に全件取得しないため）。
 */
export async function listReviewQueue(options: { take?: number } = {}): Promise<ReviewQueueArticleSummary[]> {
  const rows = await prisma.article.findMany({
    where: { status: "review" },
    select: {
      id: true,
      slug: true,
      title: true,
      category: true,
      createdAt: true,
      sources: { take: 1, select: { url: true } },
    },
    orderBy: { createdAt: "desc" },
    ...(options.take != null ? { take: options.take } : {}),
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    category: r.category,
    createdAt: r.createdAt,
    sourceUrl: r.sources[0]?.url ?? null,
  }));
}

/** レビューキューの件数（`/admin` の「未レビュー N件」バッジ用）。 */
export async function countReviewQueue(): Promise<number> {
  return prisma.article.count({ where: { status: "review" } });
}

/**
 * 要レビュー記事を承認して公開する（status="review" のときのみ許可。それ以外の状態からの
 * 呼び出しは不正な遷移として拒否し、DBを変更しない）。保留キューの承認(approveHeldArticle)とは
 * 別関数だが、公開状態への遷移内容自体は同じにする。承認は一覧ページの即時反映
 * （revalidatePublishedListings、機能B）も呼ぶ（REVALIDATE_SECRET未設定ならno-op）。
 */
export async function approveReviewArticle(articleId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { status: true } });
  if (!article) throw new Error("記事が見つかりません");
  if (article.status !== "review") {
    throw new Error(`要レビュー状態の記事のみ承認できます（現在の状態: ${article.status}）`);
  }
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
  await revalidatePublishedListings();
}

/**
 * 要レビュー記事を却下する（status="review" のときのみ許可）。既存の却下(rejectHeldArticle)と
 * 同様に status="rejected" にするだけで、ハード削除はしない。
 */
export async function rejectReviewArticle(articleId: string, auth: AdminAuthContext): Promise<void> {
  requireAuthorized(auth);
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { status: true } });
  if (!article) throw new Error("記事が見つかりません");
  if (article.status !== "review") {
    throw new Error(`要レビュー状態の記事のみ却下できます（現在の状態: ${article.status}）`);
  }
  await prisma.article.update({ where: { id: articleId }, data: { status: "rejected" } });
}
