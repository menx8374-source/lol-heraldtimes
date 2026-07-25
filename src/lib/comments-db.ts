/**
 * 記事への匿名コメント（拡張E2）の永続化ロジック（サーバー専用・Prisma使用）。
 * 判定用の純関数は lib/comments.ts に分離してあり、ここではその結果をDBに反映するだけにする。
 * Route Handler・サーバーコンポーネント・シードスクリプトからのみ import すること
 * （クライアントコンポーネントからimportするとPrismaがクライアントバンドルに含まれてしまう）。
 */
import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY } from "@/lib/articles";
import {
  validateCommentInput,
  moderateCommentContent,
  extractCommentAnchors,
  isHoneypotFilled,
  isRapidDuplicate,
  buildCommentExcerpt,
  type CommentBase,
  type CommentView,
  type CommentVoteType,
  type CommentVoteOp,
  type CreateCommentResult,
} from "@/lib/comments";

type CommentRow = {
  number: number;
  name: string;
  body: string;
  createdAt: Date;
  anchors: unknown;
  goodCount: number;
  badCount: number;
};

function toCommentBase(row: CommentRow): CommentBase {
  return {
    number: row.number,
    name: row.name,
    body: row.body,
    createdAt: row.createdAt,
    anchors: Array.isArray(row.anchors) ? (row.anchors as number[]) : [],
    goodCount: row.goodCount,
    badCount: row.badCount,
  };
}

/** Prisma のユニーク制約違反(P2002)か。同記事への同時投稿で採番が衝突したときに立つ。 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** 採番衝突(同時投稿)時のトランザクション再試行回数。 */
const NUMBERING_MAX_RETRIES = 4;

/**
 * コメント（トップレベル）または返信を投稿する（信頼境界: 閲覧者入力）。
 * 手順: ハニーポット判定 → 入力検証 → 返信先解決(parentNumber指定時) → 連投スパム判定
 *      → 安全フィルタ → 採番・永続化（原子的） → 公開時のみ Article.commentCount を加算。
 * 採番はその記事の現在の最大 number + 1（トップレベル・返信で共通の連番）。同時投稿で
 * `@@unique([articleId, number])` に衝突した場合はトランザクションごと再試行する（既定分離レベル
 * では max 読み取りが競合しうるため、一意制約＋リトライで正当なコメントが 500 で落ちないようにする）。
 * 返信スレッドは1階層のみ（拡張E8）: `parentNumber` が指す対象が既に返信（parentIdあり）の場合、
 * その返信のさらに親（トップレベルコメント）にぶら下げる。
 */
export async function createComment(
  articleId: string,
  input: { name?: string; body: string; honeypot?: string; parentNumber?: number },
): Promise<CreateCommentResult> {
  if (isHoneypotFilled(input.honeypot)) {
    return { outcome: "rejected", reason: "spam" };
  }

  const validated = validateCommentInput(input);
  if (!validated.ok) {
    return { outcome: "rejected", reason: "validation", error: validated.error };
  }
  const { name, body } = validated.value;

  let parentId: string | undefined;
  let effectiveParentNumber: number | undefined;
  if (input.parentNumber !== undefined) {
    const target = await prisma.articleComment.findUnique({
      where: { articleId_number: { articleId, number: input.parentNumber } },
      select: { id: true, number: true, status: true, parentId: true, parent: { select: { number: true } } },
    });
    if (!target || target.status !== "published") {
      return { outcome: "rejected", reason: "invalid_parent" };
    }
    // 1階層のみ: 返信先自体が返信なら、その大元の親にぶら下げる（表示上もそちらの直下に入る）。
    parentId = target.parentId ?? target.id;
    effectiveParentNumber = target.parent?.number ?? target.number;
  }

  const last = await prisma.articleComment.findFirst({
    where: { articleId },
    orderBy: { createdAt: "desc" },
    select: { body: true, createdAt: true },
  });
  if (isRapidDuplicate(body, last, new Date())) {
    return { outcome: "rejected", reason: "spam" };
  }

  const moderation = moderateCommentContent(name, body);
  const anchors = extractCommentAnchors(body);

  const persist = () =>
    prisma.$transaction(async (tx) => {
      const agg = await tx.articleComment.aggregate({
        where: { articleId },
        _max: { number: true },
      });
      const number = (agg._max.number ?? 0) + 1;

      const created = await tx.articleComment.create({
        data: {
          articleId,
          number,
          name,
          body,
          parentId,
          anchors: anchors.length > 0 ? anchors : undefined,
          status: moderation.status,
          heldReason: moderation.status === "held" ? moderation.reason : undefined,
        },
      });

      if (moderation.status === "held") {
        return { outcome: "held" } as CreateCommentResult;
      }

      await tx.article.update({
        where: { id: articleId },
        data: { commentCount: { increment: 1 } },
      });

      return {
        outcome: "published",
        comment: toCommentBase(created),
        parentNumber: effectiveParentNumber,
      } as CreateCommentResult;
    });

  for (let attempt = 0; attempt < NUMBERING_MAX_RETRIES; attempt++) {
    try {
      return await persist();
    } catch (err) {
      if (isUniqueViolation(err) && attempt < NUMBERING_MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  // ここには到達しない（最終試行の例外は上で throw される）が、型のために置く。
  throw new Error("コメントの採番に繰り返し失敗しました");
}

/** 1記事の個別ページで一度に表示する公開コメントの上限（コメントが増えても無界フェッチにしない）。 */
const MAX_COMMENTS_PER_ARTICLE = 200;

/**
 * 記事slugから公開コメント（トップレベル＋その公開返信）を番号順に取得する。
 * 存在しない/保留中の記事は空配列を返す。1〜2クエリ（記事取得＋コメント一括取得）にまとめ、
 * 返信をトップレベルコメントごとにグルーピングしてN+1を避ける（拡張E8）。
 */
export async function listPublishedCommentsBySlug(slug: string): Promise<CommentView[]> {
  const article = await prisma.article.findFirst({
    where: { slug, ...PUBLISHED_ONLY },
    select: { id: true },
  });
  if (!article) return [];

  const rows = await prisma.articleComment.findMany({
    where: { articleId: article.id, status: "published" },
    orderBy: { number: "asc" },
    take: MAX_COMMENTS_PER_ARTICLE,
    select: {
      id: true,
      parentId: true,
      number: true,
      name: true,
      body: true,
      createdAt: true,
      anchors: true,
      goodCount: true,
      badCount: true,
    },
  });

  const topLevel: CommentView[] = [];
  const byId = new Map<string, CommentView>();
  for (const row of rows) {
    if (!row.parentId) {
      const view: CommentView = { ...toCommentBase(row), replies: [] };
      byId.set(row.id, view);
      topLevel.push(view);
    }
  }
  for (const row of rows) {
    if (row.parentId) {
      // 親が同じ一括取得結果に含まれない場合（理論上は起こらないが、DB不整合に対する防御）は無視する。
      byId.get(row.parentId)?.replies.push(toCommentBase(row));
    }
  }
  return topLevel;
}

/**
 * コメント・返信への賛否投票（拡張E8、拡張E13で1ユーザー1回制限に対応）。ログイン無し方針
 * のためユーザー単位の多重防止はサーバー側では行わず、`op`（"add"省略時既定/"remove"）で
 * 加算・減算の両方に対応する。減算は0未満にならない（floorガード）。存在しない/保留中コメント・
 * 非公開記事への投票は加算しない（信頼境界: 対象IDはクライアント入力）。
 */
export async function voteOnComment(
  slug: string,
  number: number,
  type: CommentVoteType,
  op: CommentVoteOp = "add",
): Promise<{ ok: true; goodCount: number; badCount: number } | { ok: false }> {
  // 記事の公開判定はコメント取得のリレーションフィルタに畳み込み、往復を1回減らす。
  // article: PUBLISHED_ONLY により非公開記事のコメントはヒットしない。
  const comment = await prisma.articleComment.findFirst({
    where: { number, status: "published", article: { slug, ...PUBLISHED_ONLY } },
    select: { id: true, goodCount: true, badCount: true },
  });
  if (!comment) return { ok: false };

  const data =
    op === "remove"
      ? type === "good"
        ? { goodCount: Math.max(0, comment.goodCount - 1) }
        : { badCount: Math.max(0, comment.badCount - 1) }
      : type === "good"
        ? { goodCount: { increment: 1 } }
        : { badCount: { increment: 1 } };

  const updated = await prisma.articleComment.update({
    where: { id: comment.id },
    data,
    select: { goodCount: true, badCount: true },
  });
  return { ok: true, goodCount: updated.goodCount, badCount: updated.badCount };
}

export type FeaturedCommentView = {
  excerpt: string;
  articleSlug: string;
  articleTitle: string;
  createdAt: Date;
  /** 被返信数（このコメントに付いた返信の件数）。 */
  replyCount: number;
  goodCount: number;
  badCount: number;
};

/** 「注目コメント」の集計対象期間（直近N日）。この範囲に投稿された公開コメントを候補にする。 */
const FEATURED_COMMENT_WINDOW_DAYS = 3;
/** エンゲージメント順に並べ替える前に読み込む候補上限（期間内でも無界フェッチにしないため）。 */
const FEATURED_COMMENT_CANDIDATE_POOL = 300;

/**
 * サイドバーの「注目コメント」ウィジェット用: 直近 FEATURED_COMMENT_WINDOW_DAYS 日間に投稿された
 * 公開コメントのうち、返信数＋賛否リアクション数（👍👎）が多い順に上位 limit 件を返す。
 * 対象は公開記事の公開コメントのみ（保留記事・保留コメントは露出しない）。エンゲージメント0のコメントは
 * 「注目」に含めない。トップレベル・返信いずれも1コメントとして被返信数＋good/badで評価する。
 * 期間内でも新しい順に候補プールを有界化してから集計し、無界フェッチにはしない。
 */
export async function listFeaturedComments(
  limit = 5,
  now: Date = new Date(),
): Promise<FeaturedCommentView[]> {
  const cutoff = new Date(now.getTime() - FEATURED_COMMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.articleComment.findMany({
    where: {
      status: "published",
      article: { status: "published" },
      createdAt: { gte: cutoff },
    },
    orderBy: { createdAt: "desc" },
    take: FEATURED_COMMENT_CANDIDATE_POOL,
    select: {
      body: true,
      createdAt: true,
      goodCount: true,
      badCount: true,
      article: { select: { slug: true, title: true } },
      _count: { select: { replies: true } },
    },
  });

  const scored = rows.map((r) => {
    const replyCount = r._count.replies;
    const view: FeaturedCommentView = {
      excerpt: buildCommentExcerpt(r.body),
      articleSlug: r.article.slug,
      articleTitle: r.article.title,
      createdAt: r.createdAt,
      replyCount,
      goodCount: r.goodCount,
      badCount: r.badCount,
    };
    return { view, score: replyCount + r.goodCount + r.badCount };
  });

  return scored
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || b.view.createdAt.getTime() - a.view.createdAt.getTime())
    .slice(0, limit)
    .map((c) => c.view);
}
