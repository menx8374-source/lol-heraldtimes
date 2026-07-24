import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getArticleBySlug,
  incrementViewCount,
  listRelatedArticles,
} from "@/lib/articles";
import { categorySlugFor } from "@/lib/categories";
import { ArticleBodyView } from "@/components/article-body-view";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { ArticleMeta } from "@/components/article-meta";
import { ArticleList } from "@/components/article-list";
import { PageWithSidebar } from "@/components/page-with-sidebar";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);
  if (!article) {
    return { title: "記事が見つかりません" };
  }
  return { title: article.title };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = await getArticleBySlug(slug);

  if (!article) {
    notFound();
  }

  // 閲覧数の加算（書き込み）と関連記事の取得（読み込み）は互いに独立なので並列化する。
  const [, related] = await Promise.all([
    incrementViewCount(article.slug),
    listRelatedArticles(article, 3),
  ]);
  const categorySlug = categorySlugFor(article.category);

  return (
    <PageWithSidebar>
      <nav className="mb-3 text-xs text-neutral-500">
        <Link href="/" className="hover:underline">
          トップ
        </Link>
        <span className="mx-1">/</span>
        {categorySlug ? (
          <Link href={`/category/${categorySlug}`} className="hover:underline">
            {article.category}
          </Link>
        ) : (
          <span>{article.category}</span>
        )}
      </nav>

      <ArticleThumbnail
        category={article.category}
        thumbnailUrl={article.thumbnailUrl}
        className="mb-4 h-32 w-full rounded-lg sm:h-48"
      />

      <h1 className="text-xl font-bold leading-snug sm:text-2xl">{article.title}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <ArticleMeta category={article.category} publishedAt={article.publishedAt} />
        {article.unconfirmed && (
          <span className="rounded-full bg-red-600 px-2 py-0.5 font-bold text-white">
            未確認情報
          </span>
        )}
        {article.tags.map((tag) => (
          <Link
            key={tag}
            href={`/tags/${tag}`}
            className="rounded-full border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100"
          >
            #{tag}
          </Link>
        ))}
      </div>

      <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        この記事は AI により自動生成された記事です。内容は変動・変更される場合があります。
      </p>
      {article.unconfirmed && (
        <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          【未確認】この記事は未確定・噂レベルの情報を含みます。内容の真偽は確認されていません。
        </p>
      )}

      <div className="mt-4">
        <ArticleBodyView blocks={article.body} />
      </div>

      <section className="mt-6 border-t border-neutral-200 pt-4">
        <h2 className="text-sm font-bold text-neutral-600">出典</h2>
        <ul className="mt-2 flex flex-col gap-1">
          {article.sources.map((source) => (
            <li key={source.url} className="text-sm">
              <span className="mr-1 text-neutral-500">[{source.label}]</span>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="break-all text-sky-700 hover:underline"
              >
                {source.url}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 border-t border-neutral-200 pt-4">
        <h2 className="mb-3 text-sm font-bold text-neutral-600">関連記事</h2>
        <ArticleList articles={related} emptyMessage="関連記事はありません" />
      </section>

      <div className="mt-6">
        <Link href="/" className="text-sm text-sky-700 hover:underline">
          &larr; トップへ戻る
        </Link>
      </div>
    </PageWithSidebar>
  );
}
