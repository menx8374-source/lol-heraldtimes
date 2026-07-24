import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleBySlug } from "@/lib/articles";
import { ArticleBodyView } from "@/components/article-body-view";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { ArticleMeta } from "@/components/article-meta";

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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <nav className="mb-3 text-xs text-neutral-500">
        <Link href="/" className="hover:underline">
          トップ
        </Link>
        <span className="mx-1">/</span>
        <span>{article.category}</span>
      </nav>

      <ArticleThumbnail
        category={article.category}
        thumbnailUrl={article.thumbnailUrl}
        className="mb-4 h-32 w-full rounded-lg sm:h-48"
      />

      <h1 className="text-xl font-bold leading-snug sm:text-2xl">{article.title}</h1>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <ArticleMeta category={article.category} publishedAt={article.publishedAt} />
        {article.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-neutral-300 px-2 py-0.5">
            #{tag}
          </span>
        ))}
      </div>

      <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        この記事は AI により自動生成された記事です。内容は変動・変更される場合があります。
      </p>

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

      <div className="mt-6">
        <Link href="/" className="text-sm text-sky-700 hover:underline">
          &larr; トップへ戻る
        </Link>
      </div>
    </div>
  );
}
