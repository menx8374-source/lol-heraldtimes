import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";
import { selectRelatedArticles } from "@/lib/related-articles";
import { Prisma } from "@prisma/client";

const articleWithRelations = Prisma.validator<Prisma.ArticleDefaultArgs>()({
  include: {
    sources: true,
    tags: { include: { tag: true } },
  },
});

type ArticleWithRelations = Prisma.ArticleGetPayload<typeof articleWithRelations>;

export type ArticleSummary = {
  slug: string;
  title: string;
  category: string;
  thumbnailUrl: string | null;
  publishedAt: Date;
  viewCount: number;
};

export type ArticleDetail = ArticleSummary & {
  body: ArticleBodyBlock[];
  tags: string[];
  sources: { label: string; url: string }[];
  /** 未確定・噂レベルの情報と判定された記事に付与される「未確認」ラベル対象フラグ（F9）。 */
  unconfirmed: boolean;
};

/**
 * 閲覧系クエリで必ず適用する公開状態フィルタ（F9）。
 * 「公開記事は必ず安全フィルタ通過済み」という不変条件を守るため、一覧・カテゴリ・タグ・検索・
 * 人気・関連記事・個別記事表示のすべてのクエリはこの条件を経由し、保留(held)記事を露出させない。
 */
export const PUBLISHED_ONLY = { status: "published" } as const;

/** 一覧カードに必要なスカラー列だけを取得する select（本文・リレーションは取らない）。 */
export const summarySelect = {
  slug: true,
  title: true,
  category: true,
  thumbnailUrl: true,
  publishedAt: true,
  viewCount: true,
} satisfies Prisma.ArticleSelect;

/**
 * summarySelect の列を含む任意の行（追加でリレーション等を持っていてよい）から
 * ArticleSummary に射影する共有ヘルパ。ArticleSummary の列定義を一箇所に集約する。
 */
export function toSummary<T extends ArticleSummary>(row: T): ArticleSummary {
  const { slug, title, category, thumbnailUrl, publishedAt, viewCount } = row;
  return { slug, title, category, thumbnailUrl, publishedAt, viewCount };
}

function toDetail(article: ArticleWithRelations): ArticleDetail {
  return {
    ...toSummary(article),
    body: parseArticleBody(article.body),
    tags: article.tags.map((t) => t.tag.name),
    sources: article.sources.map((s) => ({ label: s.label, url: s.url })),
    unconfirmed: article.unconfirmed,
  };
}

/**
 * トップページ用: 公開済み記事のみを新しい順で取得する。
 * 並べ替えは publishedAt インデックスで DB 側に押し下げ、カード表示に不要な本文・リレーションは取得しない。
 */
export async function listArticles(): Promise<ArticleSummary[]> {
  return prisma.article.findMany({
    where: PUBLISHED_ONLY,
    select: summarySelect,
    orderBy: { publishedAt: "desc" },
  });
}

/**
 * slug から公開済み記事の詳細を取得する。存在しない、または保留(held)中の場合は null
 * （呼び出し側で 404 を判定する。保留記事は slug を知っていても直接閲覧できない）。
 * 同一リクエスト内での重複呼び出し（generateMetadata とページ本体）は React cache でメモ化する。
 */
export const getArticleBySlug = cache(
  async (slug: string): Promise<ArticleDetail | null> => {
    const article = await prisma.article.findFirst({
      where: { slug, ...PUBLISHED_ONLY },
      ...articleWithRelations,
    });
    if (!article) return null;
    return toDetail(article);
  },
);

/**
 * カテゴリ一覧ページ用: 指定カテゴリの公開済み記事だけを新しい順で取得する（F2）。
 * 該当記事が0件の場合は空配列を返す（呼び出し側で空状態を表示、エラーにはしない）。
 */
export async function listArticlesByCategory(category: string): Promise<ArticleSummary[]> {
  return prisma.article.findMany({
    where: { category, ...PUBLISHED_ONLY },
    select: summarySelect,
    orderBy: { publishedAt: "desc" },
  });
}

/**
 * タグ一覧ページ用: 指定タグを持つ公開済み記事だけを新しい順で取得する（F2）。
 * 未知のタグ名でも例外にはせず空配列を返す。
 */
export async function listArticlesByTag(tagName: string): Promise<ArticleSummary[]> {
  return prisma.article.findMany({
    where: { tags: { some: { tag: { name: tagName } } }, ...PUBLISHED_ONLY },
    select: summarySelect,
    orderBy: { publishedAt: "desc" },
  });
}

/**
 * サイドバー（PC）／記事下（スマホ）の人気記事ランキング用: 公開済み記事を閲覧数（viewCount）降順に取得する（F3）。
 */
export async function listPopularArticles(limit = 5): Promise<ArticleSummary[]> {
  return prisma.article.findMany({
    where: PUBLISHED_ONLY,
    select: summarySelect,
    orderBy: { viewCount: "desc" },
    take: limit,
  });
}

/**
 * 記事閲覧時に閲覧数を1加算する（F3）。連打・多重カウント対策は行わず、
 * ページ表示のたびに単純加算するシンプルな仕様とする。
 * 閲覧数更新の失敗は記事表示自体を止めてはいけないため、ここで捕捉してログのみ残す。
 */
export async function incrementViewCount(slug: string): Promise<void> {
  try {
    await prisma.article.update({
      where: { slug },
      data: { viewCount: { increment: 1 } },
    });
  } catch (err) {
    console.error(`viewCount の更新に失敗しました (slug=${slug}):`, err);
  }
}

/**
 * 個別記事末尾の関連記事（同カテゴリ／同タグ、自分自身除く）を取得する（F3）。
 * 選定ロジック本体は lib/related-articles.ts の純関数に委譲し、ここでは
 * DB から候補（タグ込み）を取得して渡すだけにする。
 */
export async function listRelatedArticles(
  article: ArticleDetail,
  limit = 3,
): Promise<ArticleSummary[]> {
  // 候補は最新 RELATED_CANDIDATE_POOL 件に有界化する。全記事フェッチだと自動運営で記事が
  // 増えるほど1記事表示ごとのコストが線形に膨らむため。フォールバック（最新記事での補完）も
  // この最新プール内で成立するので「関連記事は最低 limit 件」の契約は維持される。
  const RELATED_CANDIDATE_POOL = 60;
  const rows = await prisma.article.findMany({
    where: { slug: { not: article.slug }, ...PUBLISHED_ONLY },
    select: { ...summarySelect, tags: { include: { tag: true } } },
    orderBy: { publishedAt: "desc" },
    take: RELATED_CANDIDATE_POOL,
  });

  const candidates = rows.map((r) => ({
    ...toSummary(r),
    tags: r.tags.map((t) => t.tag.name),
  }));

  const selected = selectRelatedArticles(
    { slug: article.slug, category: article.category, tags: article.tags, publishedAt: article.publishedAt },
    candidates,
    limit,
  );

  return selected.map(toSummary);
}
