import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  buildMonthCalendar,
  dateLabel,
  dayCountsForMonth,
  isValidDateKey,
  isValidMonthKey,
  listArticlesByDate,
  listArticlesByMonth,
  monthLabel,
  nextMonthKey,
  prevMonthKey,
} from "@/lib/archive";
import { parsePageParam } from "@/lib/pagination";
import { ArticleList } from "@/components/article-list";
import { ArchiveCalendar } from "@/components/archive-calendar";
import { PageWithSidebar } from "@/components/page-with-sidebar";
import { Pagination } from "@/components/pagination";
import { Breadcrumbs } from "@/components/breadcrumbs";

// 一覧の自動更新（revalidate-S1 F-RV1-1）: A=短いISR（保険、既定300秒）。Bのオンデマンド再検証が主。
// Next.jsの静的AST解析の制約でインポート変数を参照できないため数値リテラルを直書きする
// （src/lib/revalidate-config.ts の LISTING_REVALIDATE_SECONDS と同値を維持すること）。
export const revalidate = 300;

/**
 * アーカイブの月別／日別ページ（拡張E4 + 拡張E10）。
 *
 * Next.js App Router は同一パス階層に異なる名前の動的セグメント（例: `[month]`と`[date]`）を
 * 共存させられない（"Ambiguous app routes" エラー）ため、`/archive/[month]`と`/archive/[date]`は
 * この1つの `[key]` ルートに統合し、`key` の形式（"YYYY-MM" か "YYYY-MM-DD" か）でページ内容を
 * 振り分ける。どちらの形式にも一致しない・実在しない日付は404にする。
 */
type Props = {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Pick<Props, "params">): Promise<Metadata> {
  const { key } = await params;
  if (isValidDateKey(key)) {
    return { title: `${dateLabel(key)}の記事一覧` };
  }
  if (isValidMonthKey(key)) {
    return { title: `${monthLabel(key)}の記事一覧` };
  }
  return { title: "アーカイブが見つかりません" };
}

export default async function ArchiveKeyPage({ params, searchParams }: Props) {
  const { key } = await params;
  const { page: pageParam } = await searchParams;
  const requestedPage = parsePageParam(pageParam);

  if (isValidDateKey(key)) {
    const result = await listArticlesByDate(key, requestedPage);
    if (!result) notFound();

    const monthKey = key.slice(0, 7);
    return (
      <PageWithSidebar>
        <Breadcrumbs
          items={[
            { name: "トップ", path: "/" },
            { name: "アーカイブ", path: "/archive" },
            { name: monthLabel(monthKey), path: `/archive/${monthKey}` },
            { name: dateLabel(key), path: `/archive/${key}` },
          ]}
        />
        <h1 className="mb-4 text-lg font-bold">{dateLabel(key)}</h1>
        <ArticleList articles={result.items} emptyMessage="この日の記事はありません" />
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          buildHref={(p) => `/archive/${key}?page=${p}`}
        />
      </PageWithSidebar>
    );
  }

  if (isValidMonthKey(key)) {
    const [result, dayCounts] = await Promise.all([
      listArticlesByMonth(key, requestedPage),
      dayCountsForMonth(key),
    ]);
    if (!result) notFound();

    const cells = buildMonthCalendar(key, dayCounts);
    return (
      <PageWithSidebar>
        <Breadcrumbs
          items={[
            { name: "トップ", path: "/" },
            { name: "アーカイブ", path: "/archive" },
            { name: monthLabel(key), path: `/archive/${key}` },
          ]}
        />
        <h1 className="mb-4 text-lg font-bold">{monthLabel(key)}</h1>
        <ArchiveCalendar
          monthKey={key}
          cells={cells}
          prevMonthKey={prevMonthKey(key)}
          nextMonthKey={nextMonthKey(key)}
        />
        <ArticleList articles={result.items} emptyMessage="記事がありません" />
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          buildHref={(p) => `/archive/${key}?page=${p}`}
        />
      </PageWithSidebar>
    );
  }

  notFound();
}
