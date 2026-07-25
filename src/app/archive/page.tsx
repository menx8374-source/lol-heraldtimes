import type { Metadata } from "next";
import Link from "next/link";
import { listArchiveMonths } from "@/lib/archive";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EmptyState } from "@/components/empty-state";

export const metadata: Metadata = { title: "月別アーカイブ" };

/** 月別アーカイブ一覧ページ（拡張E4）。公開記事が存在する月を新しい順に列挙する。 */
export default async function ArchiveIndexPage() {
  const months = await listArchiveMonths();

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "月別アーカイブ", path: "/archive" },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">月別アーカイブ</h1>
      {months.length === 0 ? (
        <EmptyState message="記事がありません" />
      ) : (
        <ul className="flex flex-col gap-2">
          {months.map((m) => (
            <li key={m.key}>
              <Link
                href={`/archive/${m.key}`}
                className="text-sm text-sky-700 hover:underline dark:text-sky-400"
              >
                {m.label}（{m.count}件）
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageWithSidebar>
  );
}
