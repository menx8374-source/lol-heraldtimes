import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPatchBySlug, listPatches } from "@/lib/lol-data/patches";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";

type Props = {
  params: Promise<{ version: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params;
  const patch = getPatchBySlug(version);
  if (!patch) {
    return { title: "パッチノートが見つかりません" };
  }
  return {
    title: `パッチ${patch.version} ${patch.title}`,
    description: patch.summary,
  };
}

/** パッチノート個別ページ（拡張E6）。内容はすべて当サイト独自の創作モックデータ。 */
export default async function PatchDetailPage({ params }: Props) {
  const { version } = await params;
  const patch = getPatchBySlug(version);

  if (!patch) {
    notFound();
  }

  const others = listPatches()
    .filter((p) => p.slug !== patch.slug)
    .slice(0, 3);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "パッチノート一覧", path: "/patches" },
          { name: `v${patch.version}`, path: `/patches/${patch.slug}` },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          v{patch.version}
        </span>
        <time dateTime={patch.releaseDate}>{patch.releaseDate}</time>
      </div>
      <h1 className="mt-1 text-xl font-bold leading-snug">{patch.title}</h1>
      <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-200">{patch.summary}</p>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold text-neutral-600 dark:text-neutral-300">主な変更点</h2>
        <ul className="flex flex-col gap-2">
          {patch.highlights.map((h) => (
            <li
              key={h}
              className="rounded border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              {h}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        本パッチノートは当サイトが独自に作成したオリジナルの創作コンテンツであり、実際のゲームバージョンとは異なります。
      </p>

      {others.length > 0 && (
        <section className="mt-8 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <h2 className="mb-3 text-sm font-bold text-neutral-600 dark:text-neutral-300">他のパッチノート</h2>
          <ul className="flex flex-col gap-2">
            {others.map((p) => (
              <li key={p.slug}>
                <Link href={`/patches/${p.slug}`} className="text-sm text-sky-700 hover:underline dark:text-sky-400">
                  v{p.version} {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        <Link href="/patches" className="text-sm text-sky-700 hover:underline dark:text-sky-400">
          &larr; パッチノート一覧へ戻る
        </Link>
      </div>
    </PageWithSidebar>
  );
}
