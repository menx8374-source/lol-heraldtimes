import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";
import { selectRelatedArticles } from "@/lib/related-articles";
import { buildArticleExcerpt } from "@/lib/seo";
import { mergeReactionCounts, type ReactionCounts } from "@/lib/reactions";
import { cutoffForPeriod, mapRankingOrder, type RankingPeriod } from "@/lib/ranking";
import {
  DEFAULT_PAGE_SIZE,
  clampPage,
  computeTotalPages,
  paginationOffset,
  type PaginationResult,
} from "@/lib/pagination";
import { Prisma } from "@prisma/client";

const articleWithRelations = Prisma.validator<Prisma.ArticleDefaultArgs>()({
  include: {
    sources: true,
    tags: { include: { tag: true } },
    reactions: true,
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
  /** タイトル下に表示する本文抜粋（拡張E1。先頭〜80字程度。本文が不正な場合は空文字）。 */
  excerpt: string;
  /** コメント数（拡張E1）。コメント投稿機能自体は無く、表示専用のカウンタ。 */
  commentCount: number;
  /** ピン留め（注目記事固定、拡張E7）。true の記事は一覧・注目枠の先頭に優先表示される。 */
  pinned: boolean;
};

export type ArticleDetail = ArticleSummary & {
  body: ArticleBodyBlock[];
  tags: string[];
  sources: { label: string; url: string }[];
  /** 未確定・噂レベルの情報と判定された記事に付与される「未確認」ラベル対象フラグ（F9）。 */
  unconfirmed: boolean;
  /** 絵文字リアクションの件数（拡張E1）。既定の全絵文字を必ず含む（未押下は0）。 */
  reactions: ReactionCounts;
  /**
   * SEOメタ・OGP（リファクタリングS5b F-S5b-3）。AI生成できた記事のみ設定され、未設定(null)の
   * 記事は表示側（generateMetadata）が従来のメタ生成にフォールバックする。
   */
  seoTitle: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
};

/**
 * 閲覧系クエリで必ず適用する公開状態フィルタ（F9）。
 * 「公開記事は必ず安全フィルタ通過済み」という不変条件を守るため、一覧・カテゴリ・タグ・検索・
 * 人気・関連記事・個別記事表示のすべてのクエリはこの条件を経由し、保留(held)記事を露出させない。
 */
export const PUBLISHED_ONLY = { status: "published" } as const;

/**
 * 一覧カードに必要なスカラー列を取得する select。excerpt 生成のため本文(body)も含める
 * （一覧規模はページネーションで有界化しているため、本文込み取得のコストは許容できる）。
 */
export const summarySelect = {
  slug: true,
  title: true,
  category: true,
  thumbnailUrl: true,
  publishedAt: true,
  viewCount: true,
  commentCount: true,
  body: true,
  pinned: true,
} satisfies Prisma.ArticleSelect;

type SummaryRow = {
  slug: string;
  title: string;
  category: string;
  thumbnailUrl: string | null;
  publishedAt: Date;
  viewCount: number;
  commentCount: number;
  body: unknown;
  pinned: boolean;
};

/** 本文(Json)から抜粋テキストを作る。不正な本文データは空文字にフォールバックし一覧表示自体は止めない。 */
function excerptFromBody(body: unknown): string {
  try {
    return buildArticleExcerpt(parseArticleBody(body));
  } catch {
    return "";
  }
}

/**
 * summarySelect の列を含む任意の行（追加でリレーション等を持っていてよい）から
 * ArticleSummary に射影する共有ヘルパ。ArticleSummary の列定義を一箇所に集約する。
 */
export function toSummary<T extends SummaryRow>(row: T): ArticleSummary {
  const { slug, title, category, thumbnailUrl, publishedAt, viewCount, commentCount, body, pinned } = row;
  return {
    slug,
    title,
    category,
    thumbnailUrl,
    publishedAt,
    viewCount,
    commentCount,
    pinned,
    excerpt: excerptFromBody(body),
  };
}

function toDetail(article: ArticleWithRelations): ArticleDetail {
  return {
    ...toSummary(article),
    body: parseArticleBody(article.body),
    tags: article.tags.map((t) => t.tag.name),
    sources: article.sources.map((s) => ({ label: s.label, url: s.url })),
    unconfirmed: article.unconfirmed,
    reactions: mergeReactionCounts(article.reactions),
    seoTitle: article.seoTitle,
    metaDescription: article.metaDescription,
    ogTitle: article.ogTitle,
    ogDescription: article.ogDescription,
  };
}

/**
 * トップページ用: 公開済み記事のみを新しい順でページ単位に取得する（拡張E1: ページネーション）。
 * 並べ替えは publishedAt インデックスで DB 側に押し下げる。要求ページが範囲外の場合は
 * 最終ページにクランプする（0件時は1ページ目・空配列を返す）。
 */
export async function listArticles(
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<ArticleSummary>> {
  return paginatedFindMany(PUBLISHED_ONLY, page, pageSize);
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
 * listArticles/listArticlesByCategory/listArticlesByTag に共通の「絞り込み条件→ページ結果」処理。
 * 月別アーカイブ（拡張E4, lib/archive.ts）も同じページング契約で流用するため export する。
 */
export async function paginatedFindMany(
  where: Prisma.ArticleWhereInput,
  page: number,
  pageSize: number,
): Promise<PaginationResult<ArticleSummary>> {
  const totalCount = await prisma.article.count({ where });
  const totalPages = computeTotalPages(totalCount, pageSize);
  const clampedPage = clampPage(page, totalPages);
  const rows = await prisma.article.findMany({
    where,
    select: summarySelect,
    // ピン留め（拡張E7）記事を各一覧の先頭に優先表示する。pinned=false 同士は従来どおり publishedAt desc。
    orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
    skip: paginationOffset(clampedPage, pageSize),
    take: pageSize,
  });
  return {
    items: rows.map(toSummary),
    page: clampedPage,
    pageSize,
    totalCount,
    totalPages,
  };
}

/**
 * カテゴリ一覧ページ用: 指定カテゴリの公開済み記事だけを新しい順でページ単位に取得する（F2 + 拡張E1）。
 * 該当記事が0件の場合は空配列を返す（呼び出し側で空状態を表示、エラーにはしない）。
 */
export async function listArticlesByCategory(
  category: string,
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<ArticleSummary>> {
  return paginatedFindMany({ category, ...PUBLISHED_ONLY }, page, pageSize);
}

/**
 * タグ一覧ページ用: 指定タグを持つ公開済み記事だけを新しい順でページ単位に取得する（F2 + 拡張E1）。
 * 未知のタグ名でも例外にはせず空配列を返す。
 */
export async function listArticlesByTag(
  tagName: string,
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<ArticleSummary>> {
  return paginatedFindMany(
    { tags: { some: { tag: { name: tagName } } }, ...PUBLISHED_ONLY },
    page,
    pageSize,
  );
}

/**
 * サイドバー（PC）／記事下（スマホ）の人気記事ランキング用: 公開済み記事を閲覧数（viewCount）降順に取得する（F3）。
 */
export async function listArticlesForSitemap(): Promise<{ slug: string; updatedAt: Date }[]> {
  return prisma.article.findMany({
    where: PUBLISHED_ONLY,
    select: { slug: true, updatedAt: true },
    orderBy: { publishedAt: "desc" },
  });
}

export async function listPopularArticles(limit = 5): Promise<ArticleSummary[]> {
  const rows = await prisma.article.findMany({
    where: PUBLISHED_ONLY,
    select: summarySelect,
    // トップの注目記事(PickupCarousel)もピン留め（拡張E7）記事を優先表示する。
    orderBy: [{ pinned: "desc" }, { viewCount: "desc" }],
    take: limit,
  });
  return rows.map(toSummary);
}

/**
 * 期間別人気記事ランキング（拡張E4: 日間/週間/月間）。累計 viewCount ではなく、
 * ArticleView（閲覧イベント）を cutoff（期間の下限日時）で絞って articleId ごとに件数集計し、
 * 多い順に上位 limit 件を返す。
 *
 * cutoff より古い ArticleView 行は、削除せずに集計クエリの where 条件で除外するだけにする
 * （物理削除はこのスプリントでは行わない。行数は増え続けるため、将来的に cutoff より十分に
 * 古い行を定期的に削除するバッチ処理を追加する余地があるが、集計自体は viewedAt インデックス
 * と limit/cutoff で有界化されているため当面は不要）。
 */
export async function listPopularArticlesByPeriod(
  period: RankingPeriod,
  limit = 5,
): Promise<ArticleSummary[]> {
  const cutoff = cutoffForPeriod(period);
  const grouped = await prisma.articleView.groupBy({
    by: ["articleId"],
    where: { viewedAt: { gte: cutoff }, article: PUBLISHED_ONLY },
    _count: { articleId: true },
    orderBy: { _count: { articleId: "desc" } },
    take: limit,
  });
  if (grouped.length === 0) return [];

  const rows = await prisma.article.findMany({
    where: { id: { in: grouped.map((g) => g.articleId) }, ...PUBLISHED_ONLY },
    select: { id: true, ...summarySelect },
  });
  const byId = new Map(rows.map((r) => [r.id, toSummary(r)]));
  return mapRankingOrder(
    grouped.map((g) => g.articleId),
    byId,
  );
}

/**
 * 記事閲覧時に閲覧数を1加算する（F3）。連打・多重カウント対策は行わず、
 * ページ表示のたびに単純加算するシンプルな仕様とする。あわせて期間別ランキング（拡張E4）の
 * 集計用に閲覧イベント（ArticleView）を1件記録する。
 * 閲覧数更新・イベント記録の失敗は記事表示自体を止めてはいけないため、ここで捕捉してログのみ残す。
 */
export async function incrementViewCount(slug: string): Promise<void> {
  try {
    const article = await prisma.article.update({
      where: { slug },
      data: { viewCount: { increment: 1 } },
    });
    await prisma.articleView.create({ data: { articleId: article.id } });
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
    {
      slug: article.slug,
      category: article.category,
      tags: article.tags,
      publishedAt: article.publishedAt,
      viewCount: article.viewCount,
    },
    candidates,
    limit,
  );

  // selected は候補生成時に toSummary 済み（excerpt/commentCount 算出済み）の ArticleSummary に
  // tags を足したものなので、ここでは ArticleSummary の列だけを明示的に組み直して tags を落とす
  // （toSummary の再適用は body を持たないため excerpt が空文字に上書きされてしまうので行わない）。
  return selected.map((s) => ({
    slug: s.slug,
    title: s.title,
    category: s.category,
    thumbnailUrl: s.thumbnailUrl,
    publishedAt: s.publishedAt,
    viewCount: s.viewCount,
    commentCount: s.commentCount,
    pinned: s.pinned,
    excerpt: s.excerpt,
  }));
}

/** 記事末回遊ウィジェット（成長G2）の候補プールサイズ。件数上限＋他ウィジェットとの重複除外後も
 * 十分な件数が残るよう、表示件数（6件目安）より十分大きく取る。 */
const SAME_CATEGORY_CANDIDATE_POOL = 30;
const SAME_TAG_CANDIDATE_POOL = 30;
/** 同タグ人気ウィジェットで使う「主要タグ」の最大数（クエリ数を抑えるため全タグは引かない）。 */
const MAIN_TAG_LIMIT = 2;

/**
 * 記事末「同じカテゴリの最新記事」ウィジェット（成長G2 F-G2-2）用の候補プールを取得する。
 * 選定（自分自身の除外・publishedAt降順・件数上限・他ウィジェットとの重複除外）は
 * lib/related-articles.ts の selectSameCategoryLatest（純関数）に委譲し、ここでは DB から
 * published のみの候補プールを取得するだけにする。この関数自体は excludeSlugs 等に依存しない
 * 独立した非同期処理なので、記事詳細ページ側で他の並列フェッチと Promise.all できる。
 */
export async function fetchSameCategoryLatestCandidates(
  article: ArticleDetail,
  poolSize: number = SAME_CATEGORY_CANDIDATE_POOL,
): Promise<(ArticleSummary & { tags: string[] })[]> {
  const { items } = await listArticlesByCategory(article.category, 1, poolSize);
  // カテゴリ最新の並び替えには tags を使わないため、RelatedCandidate 型を満たすためだけの空配列。
  return items.map((a) => ({ ...a, tags: [] as string[] }));
}

/**
 * article.tags のうち、サイト全体で（公開記事に限定して）記事数の多い順に上位 limit 個を選ぶ。
 * 「主要タグ」＝人気の高いタグを優先することで、同タグ人気ウィジェットの候補プールがレアタグに
 * 偏って0件になりやすくなるのを避ける。
 */
async function selectMainTagNames(tagNames: string[], limit: number = MAIN_TAG_LIMIT): Promise<string[]> {
  if (tagNames.length === 0) return [];
  const rows = await prisma.tag.findMany({
    where: { name: { in: tagNames } },
    select: { name: true, _count: { select: { articles: { where: { article: PUBLISHED_ONLY } } } } },
  });
  return rows
    .sort((a, b) => b._count.articles - a._count.articles || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((r) => r.name);
}

/**
 * 記事末「同じタグの人気記事」ウィジェット（成長G2 F-G2-2）用の候補プールを取得する。
 * 全タグを引くとタグ数に比例してクエリ・候補が膨らむため、記事の主要タグ（最大 MAIN_TAG_LIMIT 個）
 * に限定して候補を集める（クエリは主要タグ選定＋候補取得の2回で有界）。主要タグが無い（記事に
 * タグが1つも付いていない）場合は候補0件を返し、呼び出し側でウィジェットごと非表示にする
 * （フォールバック無し）。選定（一致タグ数→viewCount→publishedAt・件数上限・重複除外）は
 * selectSameTagPopular（純関数）に委譲する。
 */
export async function fetchSameTagPopularCandidates(
  article: ArticleDetail,
  poolSize: number = SAME_TAG_CANDIDATE_POOL,
): Promise<{ mainTagName: string; candidates: (ArticleSummary & { tags: string[] })[] }> {
  const mainTags = await selectMainTagNames(article.tags);
  if (mainTags.length === 0) return { mainTagName: "", candidates: [] };

  const rows = await prisma.article.findMany({
    where: {
      slug: { not: article.slug },
      ...PUBLISHED_ONLY,
      tags: { some: { tag: { name: { in: mainTags } } } },
    },
    select: { ...summarySelect, tags: { include: { tag: true } } },
    orderBy: { viewCount: "desc" },
    take: poolSize,
  });

  return {
    mainTagName: mainTags[0],
    candidates: rows.map((r) => ({ ...toSummary(r), tags: r.tags.map((t) => t.tag.name) })),
  };
}
