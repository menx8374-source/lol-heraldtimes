import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getArticleBySlug,
  incrementViewCount,
  listRelatedArticles,
} from "@/lib/articles";
import { categorySlugFor } from "@/lib/categories";
import { buildArticleDescription, toSafeJsonLd } from "@/lib/seo";
import { getSiteUrl } from "@/lib/site";
import { ArticleBodyView } from "@/components/article-body-view";
import { ArticleMeta } from "@/components/article-meta";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { AdSlot } from "@/components/ad-slot";
import { ShareBar } from "@/components/share-bar";
import { ShareButtons } from "@/components/share-buttons";
import { ReactionButtons } from "@/components/reaction-buttons";
import { CommentSection } from "@/components/comment-section";
import { listPublishedCommentsBySlug } from "@/lib/comments-db";

type Props = {
  params: Promise<{ slug: string }>;
};

/** thumbnailUrl（未設定時はサイト既定のOGP画像）から絶対URLの画像URLを作る。 */
function resolveOgImageUrl(siteUrl: string, thumbnailUrl: string | null): string {
  if (!thumbnailUrl) return `${siteUrl}/og-default.svg`;
  return thumbnailUrl.startsWith("http") ? thumbnailUrl : `${siteUrl}${thumbnailUrl}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) {
    return { title: "記事が見つかりません" };
  }

  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/articles/${article.slug}`;
  const description = buildArticleDescription(article.body);
  const imageUrl = resolveOgImageUrl(siteUrl, article.thumbnailUrl);

  return {
    title: article.title,
    description,
    openGraph: {
      title: article.title,
      description,
      url,
      type: "article",
      images: [{ url: imageUrl }],
    },
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  // 閲覧数の加算（書き込み）・関連記事・コメント一覧の取得は互いに独立なので並列化する。
  const [, related, comments] = await Promise.all([
    incrementViewCount(article.slug),
    listRelatedArticles(article, 3),
    listPublishedCommentsBySlug(article.slug),
  ]);
  const categorySlug = categorySlugFor(article.category);

  const siteUrl = getSiteUrl();
  const articleUrl = `${siteUrl}/articles/${article.slug}`;
  // 記事の構造化データ（F13）: 見出し・公開日時・カテゴリ等を含む記事メタ情報。
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    datePublished: article.publishedAt.toISOString(),
    articleSection: article.category,
    mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
    image: [resolveOgImageUrl(siteUrl, article.thumbnailUrl)],
    publisher: { "@type": "Organization", name: "LoLまとめ速報" },
  };

  return (
    <>
      {/* structuredData はDB由来の記事メタ情報のみで構成し、toSafeJsonLd で </script> 等の
          スクリプトタグ早期終了を防いでから埋め込む。 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toSafeJsonLd(structuredData) }}
      />
      <PageWithSidebar>
        {/* 固定シェアバー（拡張E11）。PCは本文左側にsticky追従、モバイルは画面上部にsticky追従する
            フォールバック（画面下部固定のCookie同意バナー/アンカー広告と重ならない配置）。 */}
        <div className="lg:flex lg:items-start lg:gap-3">
          <ShareBar url={articleUrl} title={article.title} />
          <div className="min-w-0 flex-1">
            <Breadcrumbs
              items={[
                { name: "トップ", path: "/" },
                ...(categorySlug
                  ? [{ name: article.category, path: `/category/${categorySlug}` }]
                  : []),
                { name: article.title, path: `/articles/${article.slug}` },
              ]}
            />

            <AdSlot position="article-top" />

            <h1 className="text-xl font-bold leading-snug sm:text-2xl">{article.title}</h1>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <ArticleMeta category={article.category} publishedAt={article.publishedAt} />
              <span className="flex items-center gap-1">
                <span aria-hidden="true">💬</span>
                {article.commentCount}
              </span>
              {article.unconfirmed && (
                <span className="rounded-full bg-red-600 px-2 py-0.5 font-bold text-white">
                  未確認情報
                </span>
              )}
              {article.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/tags/${tag}`}
                  data-tag-chip
                  className="rounded-full border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
                >
                  #{tag}
                </Link>
              ))}
            </div>

            {article.unconfirmed && (
              <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                【未確認】この記事は未確定・噂レベルの情報を含みます。内容の真偽は確認されていません。
              </p>
            )}

            <div className="mt-4">
              <ArticleBodyView blocks={article.body} />
            </div>

            <div className="mt-6 flex flex-col gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <ReactionButtons slug={article.slug} initialCounts={article.reactions} />
              <ShareButtons url={articleUrl} title={article.title} />
            </div>

            <AdSlot position="article-bottom" />

            <section data-article-sources className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <h2 className="text-sm font-bold text-neutral-600 dark:text-neutral-300">出典</h2>
              <ul className="mt-2 flex flex-col gap-1">
                {article.sources.map((source) => (
                  <li key={source.url} className="text-sm">
                    <span className="mr-1 text-neutral-500 dark:text-neutral-400">[{source.label}]</span>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="break-all text-sky-700 hover:underline dark:text-sky-400"
                    >
                      {source.url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            <div id="comments">
              <CommentSection slug={article.slug} initialComments={comments} />
            </div>

            <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">関連記事</h2>
              <ArticleList articles={related} emptyMessage="関連記事はありません" />
              {/* マッチドコンテンツ枠（拡張E5）。自サイトの関連記事(上記)に加え、記事末尾に
                  広告枠を併設する（AdSense Matched Content相当）。 */}
              <AdSlot position="matched-content" />
            </section>

            <div className="mt-6">
              <Link
                href="/"
                data-back-link
                className="text-sm text-sky-700 hover:underline dark:text-sky-400"
              >
                &larr; トップへ戻る
              </Link>
            </div>
          </div>
        </div>
      </PageWithSidebar>
    </>
  );
}
