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

/**
 * publishedAt（UTCインスタント）から日本時間(JST)基準の "YYYY-MM" キーを作る。
 * 月別も日別・カレンダー（拡張E10）と同じJST暦日基準に揃え、アーカイブ機能全体で
 * 日付境界の基準を1系統に統一する（サーバーのローカルTZに依存させない）。
 */
export function monthKeyOf(date: Date): string {
  return dayKeyOfJST(date).slice(0, 7);
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
 * "YYYY-MM" キーから、その月の [開始, 翌月開始) の半開区間（JST基準）を求める。
 * 日別・カレンダーと同一のJST境界を使うため `monthDateRangeJST` に委譲する（境界の二重定義を避ける）。
 * 不正なキーは null を返す（呼び出し側で404判定に使う）。
 */
export function monthDateRange(key: string): { start: Date; end: Date } | null {
  return monthDateRangeJST(key);
}

/** 直近 months ヶ月ぶんを含めるためのフェッチ下限（JST基準で現在の (months-1) ヶ月前の月初）。 */
function recentMonthsCutoff(months: number, now: Date = new Date()): Date {
  let key = todayMonthKeyJST(now);
  for (let i = 1; i < months; i++) key = prevMonthKey(key);
  // 有効な月キーなので monthDateRangeJST は必ず非null。
  return monthDateRangeJST(key)!.start;
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

/**
 * カレンダー式アーカイブ（拡張E10）。日付境界は必ず日本時間（JST, UTC+9固定・DST無し）で判定する。
 * `publishedAt` は UTC インスタントとして保存されるため、サーバープロセスのローカルタイムゾーン
 * （`Date#getFullYear`等）には依存せず、常に明示的な+9時間オフセットで暦日を計算する
 * （learnings: 日付境界のJSTずれは過去にi18nタグで踏んだ地雷と同種の「ローカルUTC取り違え」）。
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTCインスタントのDateを日本時間の暦日 "YYYY-MM-DD" に変換する純関数。 */
export function dayKeyOfJST(date: Date): string {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" キーが実在する暦日かどうかを厳密に判定する（例: 2026-02-30 は無効）。 */
export function isValidDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) return false;
  const check = new Date(Date.UTC(y, m - 1, d));
  return (
    check.getUTCFullYear() === y &&
    check.getUTCMonth() === m - 1 &&
    check.getUTCDate() === d
  );
}

/** "YYYY-MM-DD" キーから表示ラベル「YYYY年M月D日」を作る。不正なキーはそのまま返す。 */
export function dateLabel(key: string): string {
  if (!isValidDateKey(key)) return key;
  const [y, m, d] = key.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/**
 * "YYYY-MM-DD"（JSTの暦日）キーから、その日の[開始, 翌日開始)をUTCインスタントの半開区間で返す。
 * 不正なキーは null（呼び出し側で404/空一覧の判定に使う）。
 */
export function dayDateRangeJST(key: string): { start: Date; end: Date } | null {
  if (!isValidDateKey(key)) return null;
  const [yStr, mStr, dStr] = key.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  // JSTの00:00は UTCでは前日15:00。Date.UTC は負の時刻引数も正しく繰り下げ処理する。
  const start = new Date(Date.UTC(y, m - 1, d, -9, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * "YYYY-MM"（JSTの月）キーから、その月の[開始, 翌月開始)をUTCインスタントの半開区間で返す。
 * カレンダーの日別集計を対象月に絞ってから行うために使う（無界フェッチを避ける）。
 */
export function monthDateRangeJST(key: string): { start: Date; end: Date } | null {
  if (!isValidMonthKey(key)) return null;
  const [yStr, mStr] = key.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const start = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, -9, 0, 0, 0));
  return { start, end };
}

/** publishedAt の配列をJSTの暦日キーごとに件数集計する（カレンダーの日強調表示用）。 */
export function groupByDayJST(dates: Date[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = dayKeyOfJST(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function monthKeyFromUTCDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** "YYYY-MM" キーの前月キーを返す（年またぎを考慮）。 */
export function prevMonthKey(key: string): string {
  const [yStr, mStr] = key.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  return monthKeyFromUTCDate(new Date(Date.UTC(y, m - 2, 1)));
}

/** "YYYY-MM" キーの翌月キーを返す（年またぎを考慮）。 */
export function nextMonthKey(key: string): string {
  const [yStr, mStr] = key.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  return monthKeyFromUTCDate(new Date(Date.UTC(y, m, 1)));
}

/** 現在時刻（サーバー時刻。呼び出し側から渡す）をJSTの暦日で見た "YYYY-MM" を返す。/archive の既定表示月に使う。 */
export function todayMonthKeyJST(now: Date = new Date()): string {
  return dayKeyOfJST(now).slice(0, 7);
}

export type CalendarCell = {
  /** "YYYY-MM-DD"。前後月のパディングセルは null。 */
  date: string | null;
  /** 日（1〜31）。パディングセルは null。 */
  day: number | null;
  /** その日の公開記事数。パディングセルは0。 */
  count: number;
};

/**
 * 指定月（JST, "YYYY-MM"）のカレンダーグリッドを生成する純関数。日曜始まりの週で、
 * 月初/月末の空きは前後月にまたがらないパディングセル（date: null）で埋め、
 * 7の倍数長（週単位）の配列にする。不正な月キーは空配列を返す。
 */
export function buildMonthCalendar(
  monthKey: string,
  dayCounts: Map<string, number> = new Map(),
): CalendarCell[] {
  if (!isValidMonthKey(monthKey)) return [];
  const [yStr, mStr] = monthKey.split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1-12
  const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=日曜
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const cells: CalendarCell[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ date: null, day: null, count: 0 });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${yStr}-${mStr}-${String(day).padStart(2, "0")}`;
    cells.push({ date: dateKey, day, count: dayCounts.get(dateKey) ?? 0 });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ date: null, day: null, count: 0 });
  }
  return cells;
}

/**
 * 指定日（"YYYY-MM-DD"、JST基準）の公開記事をページ単位で取得する。キーが不正な形式の場合は null
 * （呼び出し側で404にする）。該当日に記事が0件・未来日でも null にはせず空のページ結果を返す。
 */
export async function listArticlesByDate(
  key: string,
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PaginationResult<ArticleSummary> | null> {
  const range = dayDateRangeJST(key);
  if (!range) return null;

  return paginatedFindMany(
    { ...PUBLISHED_ONLY, publishedAt: { gte: range.start, lt: range.end } },
    page,
    pageSize,
  );
}

/**
 * 指定月（JST, "YYYY-MM"）の日別公開記事件数マップ（カレンダーの日強調表示用）。
 * 対象月に絞ってからJSTの暦日キーで集計するため無界フェッチにはならない。不正な月キーは空マップ。
 */
export async function dayCountsForMonth(monthKey: string): Promise<Map<string, number>> {
  const range = monthDateRangeJST(monthKey);
  if (!range) return new Map();
  const rows = await prisma.article.findMany({
    where: { ...PUBLISHED_ONLY, publishedAt: { gte: range.start, lt: range.end } },
    select: { publishedAt: true },
  });
  return groupByDayJST(rows.map((r) => r.publishedAt));
}
