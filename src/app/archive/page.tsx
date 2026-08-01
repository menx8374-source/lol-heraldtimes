import type { Metadata } from "next";
import Link from "next/link";
import {
  buildMonthCalendar,
  dayCountsForMonth,
  listArchiveMonths,
  nextMonthKey,
  prevMonthKey,
  todayMonthKeyJST,
} from "@/lib/archive";
import { ArchiveCalendar } from "@/components/archive-calendar";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { EmptyState } from "@/components/empty-state";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

export const metadata: Metadata = { title: "アーカイブ" };

/**
 * アーカイブ入口ページ（拡張E10）。日本時間(JST)基準の今月のカレンダー（日付グリッド）を
 * 既定表示にし、記事のある日を強調する。従来の月一覧（拡張E4）も下部に残す。
 */
export default async function ArchiveIndexPage() {
  const monthKey = todayMonthKeyJST();
  const [dayCounts, months] = await Promise.all([
    dayCountsForMonth(monthKey),
    listArchiveMonths(),
  ]);
  const cells = buildMonthCalendar(monthKey, dayCounts);

  return (
    <PageWithSidebar>
      <Breadcrumbs
        items={[
          { name: "トップ", path: "/" },
          { name: "アーカイブ", path: "/archive" },
        ]}
      />
      <h1 className="mb-4 text-lg font-bold">アーカイブ</h1>
      <ArchiveCalendar
        monthKey={monthKey}
        cells={cells}
        prevMonthKey={prevMonthKey(monthKey)}
        nextMonthKey={nextMonthKey(monthKey)}
      />

      <h2 className="mb-3 text-sm font-bold text-neutral-700 dark:text-neutral-200">月別アーカイブ</h2>
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
