import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticleForEdit } from "@/lib/admin/articles-admin";
import { updateArticleAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "記事編集",
  robots: { index: false, follow: false },
};

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
};

export default async function AdminArticleEditPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { error } = await searchParams;
  const article = await getArticleForEdit(id);
  if (!article) notFound();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">記事編集</h1>
        <p className="mt-1 text-sm text-neutral-400">
          本文はブロック配列のJSONテキストとして編集します（不正な形式は保存できません）。
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            保存に失敗しました: {error}
          </div>
        )}

        <form action={updateArticleAction} className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="articleId" value={article.id} />

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold">タイトル</span>
            <input
              type="text"
              name="title"
              defaultValue={article.title}
              required
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-bold">本文（ブロック配列JSON）</span>
            <textarea
              name="bodyText"
              defaultValue={article.bodyText}
              required
              rows={20}
              spellCheck={false}
              className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-xs text-neutral-100"
            />
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              className="rounded bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600"
            >
              保存する
            </button>
            <a
              href="/admin"
              className="rounded border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              キャンセル
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
