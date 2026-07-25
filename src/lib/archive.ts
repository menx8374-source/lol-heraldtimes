/**
 * 月別アーカイブ（拡張E4）。公開記事の publishedAt から月単位（YYYY-MM）に集計・一覧する。
 * DB非依存の月キー計算・集計・妥当性判定は純関数として切り出し、Vitest で単体テストする。
 */
import { prisma } from "@/lib/prisma";
import {
  PUBLISHED_ONLY,
  paginatedFindMany,
  type ArticleSummary,
} from "@/lib/articles";
import { DEFAULT_PAGE_SIZE, type PaginationResult } from "@/lib/pagination";

export type ArchiveMonth = {
  /** "YYYY-MM" 形式のURLキー（/archive/[月] のセグメント）。 */
  key: string;
  /** 表示ラベル「YYYY年M月」。 */
  label: string;
  count: number;
};

/** "YYYY-MM" キーの形式妥当性を判定する（動的セグメント検証用）。 */
export function isValidMonthKey(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** publishedAt（ローカル時刻基準）から "YYYY-MM" キーを作る。 */
export function monthKeyOf(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** "YYYY-MM" キーから表示ラベル「YYYY年M月」を作る。不正なキーはそのまま返す。 */
export function monthLabel(key: string): string {
  if (!isValidMonthKey(key)) return key;
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

/**
 * publishedAt の配列から月別件数を集計し、新しい月が先頭に来る順で並べる純関数。
 * サイドバーウィジェット・/archive 一覧ページの両方から使う。
 */
export function groupByMonth(dates: Date[]): ArchiveMonth[] {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = monthKeyOf(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: monthLabel(key), count }))
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/**
 * "YYYY-MM" キーから、その月の [開始, 翌月開始) の半開区間を求める。
 * 不正なキーは null を返す（呼び出し側で404判定に使う）。
 */
export function monthDateRange(key: string): { start: Date; end: Date } | null {
  if (!isValidMonthKey(key)) return null;
  const [yStr, mStr] = key.split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  return {
    start: new Date(y, m - 1, 1, 0, 0, 0, 0),
    end: new Date(y, m, 1, 0, 0, 0, 0),
  };
}

/** 直近 months ヶ月ぶんを含めるためのフェッチ下限（現在の (months-1) ヶ月前の月初）。 */
function recentMonthsCutoff(months: number, now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - (months - 1), 1, 0, 0, 0, 0);
}

/**
 * 月別アーカイブ一覧（サイドバーウィジェット・/archive ページ共用）。公開記事のみを対象にする。
 * sinceMonths を指定すると直近その月数ぶんの記事だけを集計する（サイドバーは全ページ共通経路のため、
 * 直近数ヶ月しか表示しないウィジェットが全公開記事をスキャンしないよう有界化する）。省略時は全期間
 * （/archive 一覧ページ用。低頻度の単独ルート）。
 */
export async function listArchiveMonths(sinceMonths?: number): Promise<ArchiveMonth[]> {
  const where =
    sinceMonths && sinceMonths > 0
      ? { ...PUBLISHED_ONLY, publishedAt: { gte: recentMonthsCutoff(sinceMonths) } }
      : PUBLISHED_ONLY;
  const rows = await prisma.article.findMany({
    where,
    select: { publishedAt: true },
  });
  return groupByMonth(rows.map((r) => r.publishedAt));
}

/**
 * 指定月（"YYYY-MM"）の公開記事をページ単位で取得する。キーが不正な形式の場合は null
 * （呼び出し側で404にする）。該当月に記事が0件でも null にはせず空のページ結果を返す。
 */
export async function listArticlesByMonth(
  key: string,
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<ArticleSummary> | null> {
  const range = monthDateRange(key);
  if (!range) return null;

  return paginatedFindMany(
    { ...PUBLISHED_ONLY, publishedAt: { gte: range.start, lt: range.end } },
    page,
    pageSize,
  );
}
