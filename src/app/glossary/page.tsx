import type { Metadata } from "next";
import { listGlossaryTerms } from "@/lib/lol-data/glossary";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EmptyState } from "@/components/empty-state";

type Props = {
  searchParams: Promise<{ q?: string }>;
};

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  return {
    title: query ? `「${query}」の用語検索結果` : "LoL用語集",
    description:
      "League of Legends（LoL）でよく使われる用語（ガンク・CS・ピール等）を五十音順にまとめた用語集。初心者にも分かる平易な解説付き。",
  };
}

/** 用語集ページ（拡張E6）。定義文はすべて当サイト独自の書き起こし。 */
export default async function GlossaryPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const terms = listGlossaryTerms(query);

  return (
    <PageWithSidebar>
      <Breadcrumbs items={[{ name: "トップ", path: "/" }, { name: "用語集", path: "/glossary" }]} />
      <h1 className="mb-2 text-lg font-bold">LoL用語集</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        定義はすべて当サイトが独自に平易な言葉で書き起こしたものです。五十音順に並んでいます。
      </p>

      <form action="/glossary" method="get" role="search" className="mb-4 flex max-w-sm items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="用語で絞り込み（例: ガンク）"
          aria-label="用語を検索"
          className="w-full min-w-0 rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-600 dark:bg-neutral-800"
        />
        <button
          type="submit"
          className="shrink-0 rounded bg-sky-600 px-3 py-1 text-sm font-medium text-white hover:bg-sky-500"
        >
          検索
        </button>
      </form>

      {terms.length === 0 ? (
        <EmptyState message="該当する用語が見つかりませんでした" />
      ) : (
        <dl className="flex flex-col gap-3">
          {terms.map((t) => (
            <div
              key={t.slug}
              id={t.slug}
              className="rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <dt className="font-bold">{t.term}</dt>
              <dd className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{t.definition}</dd>
            </div>
          ))}
        </dl>
      )}
    </PageWithSidebar>
  );
}
