import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticleForEdit } from "@/lib/admin/articles-admin";
import { ArticleEditor } from "./ArticleEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "記事編集",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * 構造化エディタ（admincms-S3 F7/F8）: 本文ブロックをカードで並べて編集する画面。
 * データ取得(サーバーコンポーネント)と入力状態の保持(`ArticleEditor`, Client Component)を分離する。
 * 保存の成功/失敗は`ArticleEditor`側の`useActionState`が受け取るため、この画面はURLクエリで
 * エラーを受け渡さない（検証NG時にDB再取得で入力内容が消えるのを避けるための設計、admincms-S3補完）。
 */
export default async function AdminArticleEditPage({ params }: Props) {
  const { id } = await params;
  const article = await getArticleForEdit(id);
  if (!article) notFound();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">記事編集</h1>
        <p className="mt-1 text-sm text-neutral-400">
          本文ブロックをカードとして編集します（追加/削除/並べ替え可能）。
        </p>

        <ArticleEditor
          articleId={article.id}
          initialTitle={article.title}
          initialMetaDescription={article.metaDescription}
          initialCategory={article.category}
          initialTags={article.tags}
          initialThumbnailUrl={article.thumbnailUrl}
          initialStatus={article.status}
          initialBlocks={article.body}
        />
      </div>
    </div>
  );
}
