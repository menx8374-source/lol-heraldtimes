import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleByIdForAdminPreview } from "@/lib/articles";
import { shouldShowHeroThumbnail } from "@/lib/article-body";
import { ArticleBodyView } from "@/components/article-body-view";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { approveReviewArticleAction, rejectReviewArticleAction } from "@/app/admin/actions";

// 記事の最新状態を必ず反映するため毎回DBから取得する（管理系ページの既定パターン、edit/page.tsxと同様）。
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "記事プレビュー",
  // 公開ページと同一体裁で表示するが、公開ページそのものではないため検索エンジンには出さない（F4）。
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * 管理画面プレビュー（admincms-S1 F4）。要レビュー・保留等どの状態の記事も、公開記事ページと
 * 同じ本文描画コンポーネント（ArticleBodyView）を再利用して同一体裁で表示する。
 * GET相当（状態変更なし）で、承認/却下/編集への導線のみを提供する。
 */
export default async function AdminArticlePreviewPage({ params }: Props) {
  const { id } = await params;
  const article = await getArticleByIdForAdminPreview(id);
  if (!article) notFound();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin"
            className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
          >
            ← レビューキューに戻る
          </Link>
          <Link
            href={`/admin/articles/${id}/edit`}
            className="rounded border border-neutral-700 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-900"
          >
            編集する
          </Link>
          <form action={approveReviewArticleAction}>
            <input type="hidden" name="articleId" value={id} />
            <button
              type="submit"
              className="rounded bg-emerald-700 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-600"
            >
              承認して公開
            </button>
          </form>
          <form action={rejectReviewArticleAction}>
            <input type="hidden" name="articleId" value={id} />
            <button
              type="submit"
              className="rounded bg-red-800 px-3 py-1 text-xs font-bold text-white hover:bg-red-700"
            >
              却下
            </button>
          </form>
        </div>

        <p className="mt-3 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-400">
          プレビュー表示です。公開ページと同じ体裁で確認できますが、このページを開いても記事の状態は変わりません。
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span className="rounded bg-neutral-800 px-2 py-0.5">{article.category}</span>
          {article.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-neutral-700 px-2 py-0.5">
              #{tag}
            </span>
          ))}
        </div>

        <h1 className="mt-2 text-xl font-bold leading-snug sm:text-2xl">{article.title}</h1>

        {shouldShowHeroThumbnail(article.body) && (
          <div className="mt-4">
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

        <div className="mt-4 text-neutral-100">
          <ArticleBodyView blocks={article.body} />
        </div>
      </div>
    </div>
  );
}
