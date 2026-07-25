/**
 * 記事への匿名コメント（拡張E2）の永続化ロジック（サーバー専用・Prisma使用）。
 * 判定用の純関数は lib/comments.ts に分離してあり、ここではその結果をDBに反映するだけにする。
 * Route Handler・サーバーコンポーネント・シードスクリプトからのみ import すること
 * （クライアントコンポーネントからimportするとPrismaがクライアントバンドルに含まれてしまう）。
 */
import { prisma } from "@/lib/prisma";
import {
  validateCommentInput,
  moderateCommentContent,
  extractCommentAnchors,
  isHoneypotFilled,
  isRapidDuplicate,
  buildCommentExcerpt,
  type CommentView,
  type CreateCommentResult,
} from "@/lib/comments";

type CommentRow = {
  number: number;
  name: string;
  body: string;
  createdAt: Date;
  anchors: unknown;
};

function toCommentView(row: CommentRow): CommentView {
  return {
    number: row.number,
    name: row.name,
    body: row.body,
    createdAt: row.createdAt,
    anchors: Array.isArray(row.anchors) ? (row.anchors as number[]) : [],
  };
}

/** Prisma のユニーク制約違反(P2002)か。同記事への同時投稿で採番が衝突したときに立つ。 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** 採番衝突(同時投稿)時のトランザクション再試行回数。 */
const NUMBERING_MAX_RETRIES = 4;

/**
 * コメントを投稿する（信頼境界: 閲覧者入力）。
 * 手順: ハニーポット判定 → 入力検証 → 連投スパム判定 → 安全フィルタ → 採番・永続化（原子的）
 *      → 公開時のみ Article.commentCount を加算。
 * 採番はその記事の現在の最大 number + 1。同時投稿で `@@unique([articleId, number])` に衝突した場合は
 * トランザクションごと再試行する（既定分離レベルでは max 読み取りが競合しうるため、一意制約＋リトライで
 * 正当なコメントが 500 で落ちないようにする）。
 */
export async function createComment(
  articleId: string,
  input: { name?: string; body: string; honeypot?: string },
): Promise<CreateCommentResult> {
  if (isHoneypotFilled(input.honeypot)) {
    return { outcome: "rejected", reason: "spam" };
  }

  const validated = validateCommentInput(input);
  if (!validated.ok) {
    return { outcome: "rejected", reason: "validation", error: validated.error };
  }
  const { name, body } = validated.value;

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

      return { outcome: "published", comment: toCommentView(created) } as CreateCommentResult;
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

/** 記事slugから公開コメントの一覧を番号順に取得する。存在しない/保留中の記事は空配列を返す。 */
export async function listPublishedCommentsBySlug(slug: string): Promise<CommentView[]> {
  const article = await prisma.article.findFirst({
    where: { slug, status: "published" },
    select: { id: true },
  });
  if (!article) return [];

  const rows = await prisma.articleComment.findMany({
    where: { articleId: article.id, status: "published" },
    orderBy: { number: "asc" },
    take: MAX_COMMENTS_PER_ARTICLE,
  });
  return rows.map(toCommentView);
}

export type RecentCommentView = {
  excerpt: string;
  articleSlug: string;
  articleTitle: string;
  createdAt: Date;
};

/**
 * サイドバーの「新着コメント」ウィジェット用: 全記事横断で直近の公開コメントを新しい順に取得する。
 * 対象記事が公開中(published)のもののみに絞り、保留記事へのコメントを露出させない。
 */
export async function listRecentComments(limit = 5): Promise<RecentCommentView[]> {
  const rows = await prisma.articleComment.findMany({
    where: { status: "published", article: { status: "published" } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      body: true,
      createdAt: true,
      article: { select: { slug: true, title: true } },
    },
  });
  return rows.map((r) => ({
    excerpt: buildCommentExcerpt(r.body),
    articleSlug: r.article.slug,
    articleTitle: r.article.title,
    createdAt: r.createdAt,
  }));
}
