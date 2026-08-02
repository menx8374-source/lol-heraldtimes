/**
 * 運営CMS（拡張E7）: 記事の承認/却下・編集・ピン留め・予約公開設定の永続化ロジック。
 * すべての関数は `AdminAuthContext` を受け取り、最初に `requireAuthorized` で認可チェックする
 * （未認証呼び出しは UnauthorizedError を投げてDBを一切変更しない）。
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";
import { validateReactionAnchors, validateTocAnchors } from "@/lib/admin/article-editor-form";
import { bodyBlocksToText } from "@/lib/search";
import { moderateArticleContent } from "@/lib/moderation/moderate";
import { requireAuthorized, type AdminAuthContext } from "@/lib/admin/auth-context";
import { CATEGORY_LABELS, type CategoryLabel } from "@/lib/categories";

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

/** 構造化エディタ（admincms-S3）用: 編集画面が必要とする記事の全フィールド。 */
export type AdminArticleEditData = {
  id: string;
  title: string;
  metaDescription: string;
  category: string;
  tags: string[];
  thumbnailUrl: string;
  status: string;
  body: ArticleBodyBlock[];
};

/** 編集フォーム用: 記事のタイトル・メタ・タグ・本文(検証済みブロック配列)を取得する。 */
export async function getArticleForEdit(articleId: string): Promise<AdminArticleEditData | null> {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { tags: { include: { tag: true } } },
  });
  if (!article) return null;
  return {
    id: article.id,
    title: article.title,
    metaDescription: article.metaDescription ?? "",
    category: article.category,
    tags: article.tags.map((t) => t.tag.name),
    thumbnailUrl: article.thumbnailUrl ?? "",
    status: article.status,
    body: parseArticleBody(article.body),
  };
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

/** `updateArticleContent` の入力（構造化エディタ、admincms-S3）。 */
export type UpdateArticleContentInput = {
  title: string;
  metaDescription?: string;
  category: string;
  tags: string[];
  thumbnailUrl?: string;
  /**
   * "review"/"published" を指定したときのみその状態へ遷移する。undefined は現在の状態を
   * 変えない（held/rejected/scheduled 等、エディタの2択トグル対象外の状態を保つ＝編集で
   * 勝手に公開しない）。
   */
  status?: "review" | "published";
  /** 検証前の本文（`parseArticleBody` に通す前の値。ブロック配列でもJSONパース後の値でもよい）。 */
  body: unknown;
};

/**
 * 記事のタイトル・メタ情報・カテゴリ・タグ・サムネイル・公開状態・本文を編集する（admincms-S3構造化
 * エディタ、S4でパッチ系ブロックを追加）。本文は必ず `parseArticleBody`＋`validateReactionAnchors`
 * （同一記事内に存在するreaction番号かの整合）＋`validateTocAnchors`（同一記事内に存在する
 * heading anchorかの整合）を通し、不正なら例外メッセージ（`本文ブロック[i]の…`の粒度）をそのまま投げて
 * 記事を一切変更しない。編集後の内容は安全フィルタ（NGワード/出典欠落/個人中傷）を再チェックし、
 * 「公開される予定だったが編集後は不合格」なら保留(held)へ落として公開の不変条件を守る
 * （status を変更対象にしていない場合＝held/rejected/scheduled はそのまま編集内容のみ反映し、
 * 状態は変えない＝編集で勝手に公開しない）。tags は connectOrCreate で置換更新する
 * （追加/削除が反映され既存タグを失わない）。
 *
 * 戻り値（admincms-S5 F10で追加）: 記事のslug。編集フォームはslugを変更できないため保存前の値と
 * 同一だが、呼び出し元（`updateArticleAction`）が個別記事詳細ページ(`/articles/[slug]`)を
 * `revalidatePath`するために必要（公開後編集の即時反映）。
 */
export async function updateArticleContent(
  articleId: string,
  input: UpdateArticleContentInput,
  auth: AdminAuthContext,
): Promise<{ slug: string }> {
  requireAuthorized(auth);

  const title = input.title.trim();
  if (!title) throw new Error("タイトルは必須です");
  if (!CATEGORY_LABELS.includes(input.category as CategoryLabel)) {
    throw new Error(`カテゴリが不正です: ${input.category}`);
  }

  let body: ArticleBodyBlock[];
  try {
    body = parseArticleBody(input.body);
    validateReactionAnchors(body);
    validateTocAnchors(body);
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: { sources: true },
  });
  if (!article) throw new Error("記事が見つかりません");

  const bodyText = bodyBlocksToText(body);
  const moderation = moderateArticleContent({ title, bodyText, sourceCount: article.sources.length });

  const tags = Array.from(new Set(input.tags.map((t) => t.trim()).filter((t) => t.length > 0)));
  const metaDescription = input.metaDescription?.trim() || null;
  const thumbnailUrl = input.thumbnailUrl?.trim() || null;

  const data: Prisma.ArticleUpdateInput = {
    title,
    body,
    category: input.category,
    metaDescription,
    thumbnailUrl,
    tags: {
      deleteMany: {},
      create: tags.map((name) => ({ tag: { connectOrCreate: { where: { name }, create: { name } } } })),
    },
  };

  if (input.status === "published") {
    data.status = "published";
    if (article.status !== "published") data.publishedAt = new Date();
    data.heldReason = null;
    data.heldDetail = null;
    data.scheduledAt = null;
  } else if (input.status === "review") {
    data.status = "review";
  }

  const resultingStatus = typeof data.status === "string" ? data.status : article.status;
  if (resultingStatus === "published" && moderation.status !== "published") {
    data.status = "held";
    data.heldReason = moderation.reason;
    data.heldDetail = moderation.detail;
  }
  if (moderation.status === "published") {
    data.unconfirmed = moderation.unconfirmed;
  }

  await prisma.article.update({ where: { id: articleId }, data });
  return { slug: article.slug };
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
 * レビューキュー（admincms-S1 F2、admincms-S5 F11でカテゴリ絞込を追加）: status="review" の記事を
 * 新しい順で取得する。take を指定すると DB 側で件数を絞る（未承認が積み上がっても無界に全件取得
 * しないため）。category を指定すると、そのカテゴリの要レビュー記事のみに絞り込む（未指定=全件、
 * 他状態（公開・保留・却下・予約）の記事は status="review" 条件により混ざらない）。
 */
export async function listReviewQueue(
  options: { take?: number; category?: string } = {},
): Promise<ReviewQueueArticleSummary[]> {
  const rows = await prisma.article.findMany({
    where: { status: "review", ...(options.category ? { category: options.category } : {}) },
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
 * 別関数だが、公開状態への遷移内容自体は同じにする。
 *
 * 一覧ページへの即時反映（admincms-S5設計整理）: この関数自体はHTTPループバック（機能B）を呼ばない
 * （呼び出し元の`approveReviewArticleAction`が同一プロセス内で直接`revalidatePath`する。1件ずつ
 * HTTP往復していた旧実装は、一括承認N件でN回のHTTP呼び出しになる非効率と、個別承認との反映経路の
 * 非対称を生んでいたため撤去した）。戻り値の`slug`はその`revalidatePath("/articles/[slug]")`用。
 */
export async function approveReviewArticle(
  articleId: string,
  auth: AdminAuthContext,
): Promise<{ slug: string }> {
  requireAuthorized(auth);
  const article = await prisma.article.findUnique({ where: { id: articleId }, select: { status: true, slug: true } });
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
  return { slug: article.slug };
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

/** `bulkApproveReviewArticles` の結果（admincms-S5 F11、一括承認）。 */
export type BulkApproveResult = {
  /** 承認に成功した記事（id・slug）の一覧。呼び出し元がslugを使って個別詳細ページ
   * (`/articles/[slug]`)を再検証できるよう、idだけでなくslugも返す（evaluatorフィードバック対応:
   * 一括承認は個別承認と同様に各記事の詳細ページも即時反映する）。 */
  succeeded: { id: string; slug: string }[];
  /** 承認に失敗した記事ID＋理由（不正な状態遷移・記事が存在しない等、`approveReviewArticle` の
   * 例外メッセージをそのまま使う）。 */
  failed: { id: string; reason: string }[];
};

/**
 * 選択された複数の要レビュー記事をまとめて承認する（admincms-S5 F11）。1件ずつ `approveReviewArticle`
 * を呼び、成功/失敗を集計して返す（1件の失敗が他の承認を止めない＝部分成功を許す）。articleIds が
 * 空配列のときは何も行わず `{succeeded:[], failed:[]}` を返す（呼び出し元＝サーバーアクションが
 * 「記事が選択されていません」案内に変換する）。
 */
export async function bulkApproveReviewArticles(
  articleIds: string[],
  auth: AdminAuthContext,
): Promise<BulkApproveResult> {
  requireAuthorized(auth);
  const succeeded: { id: string; slug: string }[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const articleId of articleIds) {
    try {
      const { slug } = await approveReviewArticle(articleId, auth);
      succeeded.push({ id: articleId, slug });
    } catch (err) {
      failed.push({ id: articleId, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { succeeded, failed };
}
