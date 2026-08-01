import type { Metadata } from "next";
import Link from "next/link";
import { listPatches } from "@/lib/lol-data/patches";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

export const metadata: Metadata = {
  title: "パッチノート一覧",
  description:
    "League of Legends（LoL）の過去バージョンのパッチノートをまとめた一覧。バージョン・日付・主な変更点を確認できます。",
};

/** パッチノート一覧ページ（拡張E6）。内容はすべて当サイト独自の創作モックデータ。 */
export default function PatchesPage() {
  const patches = listPatches();

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "パッチノート一覧", path: "/patches" },
        ]}
      />
      <h1 className="mb-2 text-lg font-bold">パッチノート一覧</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        本パッチノートは当サイトが独自に作成したオリジナルの創作コンテンツです。実際のゲームバージョンとは異なります。
      </p>

      <ul className="flex flex-col gap-3">
        {patches.map((patch) => (
          <li key={patch.slug}>
            <Link
              href={`/patches/${patch.slug}`}
              className="block rounded-lg border border-neutral-200 bg-white p-3 shadow-sm hover:border-sky-400 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-sky-500"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span className="rounded bg-neutral-100 px-2 py-0.5 font-mono font-bold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                  v{patch.version}
                </span>
                <time dateTime={patch.releaseDate}>{patch.releaseDate}</time>
              </div>
              <h2 className="mt-1 text-sm font-bold sm:text-base">{patch.title}</h2>
              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300 sm:text-sm">
                {patch.summary}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </PageWithSidebar>
  );
}
