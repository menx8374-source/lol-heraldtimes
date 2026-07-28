import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getArticleBySlug,
  incrementViewCount,
  listRelatedArticles,
  fetchSameCategoryLatestCandidates,
  fetchSameTagPopularCandidates,
} from "@/lib/articles";
import { selectSameCategoryLatest, selectSameTagPopular } from "@/lib/related-articles";
import { buildHubLinks } from "@/lib/hub-links";
import { categorySlugFor, isReactionCategory } from "@/lib/categories";
import { pickDeterministicChampionSplashUrl } from "@/lib/generation/champion-splash";
import { shouldShowHeroThumbnail } from "@/lib/article-body";
import { buildArticleDescription, buildNewsArticleJsonLd, toSafeJsonLd } from "@/lib/seo";
import { getSiteUrl, SITE_NAME } from "@/lib/site";
import { ArticleBodyView } from "@/components/article-body-view";
import { ArticleThumbnail } from "@/components/article-thumbnail";
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

/**
 * thumbnailUrl から絶対URLのOGP画像URLを作る（拡張E38 F-E38-4）。
 * thumbnailUrl が無く、かつ反応カテゴリ（5chの反応/海外の反応）のときは、E37より前に
 * 生成された既存記事も再生成なしでチャンピオンアートのOG画像になるよう、slugから決定論的に
 * 選んだチャンピオンの公式スプラッシュ（既にhttps絶対URL）を返す。それ以外（非反応カテゴリ・
 * slug無し）は従来どおりサイト既定のOGP画像。
 */
function resolveOgImageUrl(
  siteUrl: string,
  thumbnailUrl: string | null,
  category: string,
  slug: string,
): string {
  if (thumbnailUrl) {
    return thumbnailUrl.startsWith("http") ? thumbnailUrl : `${siteUrl}${thumbnailUrl}`;
  }
  if (isReactionCategory(category) && slug) {
    return pickDeterministicChampionSplashUrl(slug);
  }
  return `${siteUrl}/og-default.svg`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) {
    return { title: "記事が見つかりません" };
  }

  const siteUrl = getSiteUrl();
  const url = `${siteUrl}/articles/${article.slug}`;
  // SEO列（リファクタリングS5b F-S5b-3）: AI生成できた記事はそれを優先し、未設定(null)の記事は
  // 従来のメタ生成にフォールバックする（既存記事・mock生成でも壊れない）。
  const title = article.seoTitle ?? article.title;
  const description = article.metaDescription ?? buildArticleDescription(article.body);
  const ogTitle = article.ogTitle ?? article.seoTitle ?? article.title;
  const ogDescription = article.ogDescription ?? article.metaDescription ?? buildArticleDescription(article.body);
  const imageUrl = resolveOgImageUrl(siteUrl, article.thumbnailUrl, article.category, article.slug);

  return {
    title,
    description,
    openGraph: {
      title: ogTitle,
      description: ogDescription,
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

  // 閲覧数の加算（書き込み）・関連記事・記事末回遊（同カテゴリ最新／同タグ人気）の候補プール・
  // コメント一覧の取得は互いに独立なDBアクセスなので並列化する（成長G2 F-G2-2。逐次化しない）。
  const [, related, sameCategoryCandidates, sameTagPopularFetch, comments] = await Promise.all([
    incrementViewCount(article.slug),
    listRelatedArticles(article, 6),
    fetchSameCategoryLatestCandidates(article),
    fetchSameTagPopularCandidates(article),
    listPublishedCommentsBySlug(article.slug),
  ]);

  // 候補プールの取得（DBアクセス）は並列で終えた後、選定（純関数・同期処理）だけを
  // 「関連記事 → 同カテゴリ最新 → 同タグ人気」の順に既出slugを積み上げながら行う
  // （3ウィジェット間の重複表示防止。決定論的で追加のDBアクセスは発生しない）。
  const currentCandidate = {
    slug: article.slug,
    category: article.category,
    tags: article.tags,
    publishedAt: article.publishedAt,
    viewCount: article.viewCount,
  };
  const relatedSlugs = new Set(related.map((a) => a.slug));
  const sameCategoryLatest = selectSameCategoryLatest(
    currentCandidate,
    sameCategoryCandidates,
    6,
    relatedSlugs,
  );
  const seenSlugs = new Set([...relatedSlugs, ...sameCategoryLatest.map((a) => a.slug)]);
  const sameTagPopular = selectSameTagPopular(
    currentCandidate,
    sameTagPopularFetch.candidates,
    6,
    seenSlugs,
  );

  const categorySlug = categorySlugFor(article.category);
  const hubLinks = buildHubLinks({
    category: article.category,
    categorySlug,
    tags: article.tags,
  });

  const siteUrl = getSiteUrl();
  const articleUrl = `${siteUrl}/articles/${article.slug}`;
  // 記事の構造化データ（F13＋成長G5 F-G5-2）: 見出し・公開日時・更新日時・カテゴリ・
  // 運営者(author)・publisher.logo を含む記事メタ情報。BreadcrumbList は Breadcrumbs
  // コンポーネント（下記）が別scriptで併せて出力する。
  const structuredData = buildNewsArticleJsonLd(
    {
      title: article.title,
      category: article.category,
      articleUrl,
      publishedAt: article.publishedAt,
      updatedAt: article.updatedAt,
      images: [resolveOgImageUrl(siteUrl, article.thumbnailUrl, article.category, article.slug)],
    },
    siteUrl,
    SITE_NAME,
  );

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

            {/* 記事冒頭のサムネ画像(拡張E50 F-E50-2)。本文先頭が既にimageブロック(パッチ記事の
                公式バナー、拡張E42)の場合は二重表示になるため出さない。 */}
            {shouldShowHeroThumbnail(article.body) && (
              <div className="mt-4">
                {/* 拡張E52: 見切れ・過度な引き伸ばしを避けるため、切り抜き(object-cover)をやめ
                    全体を表示(object-contain)・自然サイズ上限で中央寄せする。 */}
                <ArticleThumbnail
                  thumbnailUrl={article.thumbnailUrl}
                  category={article.category}
                  slug={article.slug}
                  alt={article.title}
                  objectFit="contain"
                  className="mx-auto block max-h-[26rem] w-auto max-w-full rounded-lg"
                />
              </div>
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

            {/* 同じカテゴリの最新記事（成長G2 F-G2-3）。候補が0件のときはセクションごと非表示。 */}
            {sameCategoryLatest.length > 0 && (
              <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">
                  『{article.category}』の最新記事
                </h2>
                <ArticleList articles={sameCategoryLatest} emptyMessage="" />
              </section>
            )}

            {/* 同じタグの人気記事（成長G2 F-G2-3）。候補が0件のときはセクションごと非表示。 */}
            {sameTagPopular.length > 0 && (
              <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
                <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">
                  #{sameTagPopularFetch.mainTagName} の人気記事
                </h2>
                <ArticleList articles={sameTagPopular} emptyMessage="" />
              </section>
            )}

            {/* ハブ導線（成長G2 F-G2-3/F-G2-4・R7）。キーワード（カテゴリ名/タグ名）を含む
                アンカーテキストで /category/<slug>・/tags/<tag> へ誘導する「まとめて見る」導線。 */}
            {hubLinks.length > 0 && (
              <nav
                aria-label="関連ハブへの導線"
                className="mt-6 flex flex-wrap gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800"
              >
                {hubLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-full border border-sky-300 px-3 py-1 text-xs text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-400 dark:hover:bg-sky-950"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            )}

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
