import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { parseArticleBody, type ArticleBodyBlock } from "@/lib/article-body";
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
};

/** 一覧カードに必要なスカラー列だけを取得する select（本文・リレーションは取らない）。 */
const summarySelect = {
  slug: true,
  title: true,
  category: true,
  thumbnailUrl: true,
  publishedAt: true,
  viewCount: true,
} satisfies Prisma.ArticleSelect;

function toDetail(article: ArticleWithRelations): ArticleDetail {
  return {
    slug: article.slug,
    title: article.title,
    category: article.category,
    thumbnailUrl: article.thumbnailUrl,
    publishedAt: article.publishedAt,
    viewCount: article.viewCount,
    body: parseArticleBody(article.body),
    tags: article.tags.map((t) => t.tag.name),
    sources: article.sources.map((s) => ({ label: s.label, url: s.url })),
  };
}

/**
 * トップページ用: 全記事を新しい順で取得する。
 * 並べ替えは publishedAt インデックスで DB 側に押し下げ、カード表示に不要な本文・リレーションは取得しない。
 */
export async function listArticles(): Promise<ArticleSummary[]> {
  return prisma.article.findMany({
    select: summarySelect,
    orderBy: { publishedAt: "desc" },
  });
}

/**
 * slug から記事詳細を取得する。存在しない場合は null（呼び出し側で 404 を判定する）。
 * 同一リクエスト内での重複呼び出し（generateMetadata とページ本体）は React cache でメモ化する。
 */
export const getArticleBySlug = cache(
  async (slug: string): Promise<ArticleDetail | null> => {
    const article = await prisma.article.findUnique({
      where: { slug },
      ...articleWithRelations,
    });
    if (!article) return null;
    return toDetail(article);
  },
);
