/**
 * 一覧ページ（トップ／カテゴリ／タグ／検索）共通のページネーション純関数群（拡張E1）。
 * DB 側 skip/take で使う値の算出（listArticles 系）と、メモリ上配列のページ分割
 * （searchArticles のように事前にフィルタしてから区切る場合）の両方をここに集約する。
 */

export const DEFAULT_PAGE_SIZE = 20;

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

/**
 * searchParams の `?page=` 文字列を安全な1始まりの整数ページ番号にパースする。
 * 未指定・NaN・0以下・小数・非数値文字列は 1 にフォールバックする
 * （範囲の上限側のクランプは呼び出し側で totalPages を使って行う）。
 */
export function parsePageParam(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

/** 総件数とページサイズから総ページ数を求める。0件のときも最低1ページとして扱う。 */
export function computeTotalPages(totalCount: number, pageSize: number): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

/** 要求ページ番号を 1..totalPages の範囲にクランプする（範囲外ページ要求の安全な扱い）。 */
export function clampPage(page: number, totalPages: number): number {
  if (page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

/** クランプ済みページ番号とページサイズから DB の skip（オフセット）を算出する。 */
export function paginationOffset(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}

/**
 * 事前に絞り込み済みの配列に対してページングを適用する（DB の skip/take が使えない、
 * 検索のようにアプリ側で全件フィルタしてから区切るケース用）。
 */
export function paginateArray<T>(
  items: T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): PaginationResult<T> {
  const totalCount = items.length;
  const totalPages = computeTotalPages(totalCount, pageSize);
  const clamped = clampPage(page, totalPages);
  const offset = paginationOffset(clamped, pageSize);
  return {
    items: items.slice(offset, offset + pageSize),
    page: clamped,
    pageSize,
    totalCount,
    totalPages,
  };
}
