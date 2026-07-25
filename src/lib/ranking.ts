/**
 * 期間別人気記事ランキング（拡張E4）の純関数群。ArticleView（閲覧イベント）の集計は
 * lib/articles.ts の listPopularArticlesByPeriod が担い、ここでは cutoff 算出・並び順の
 * 突き合わせといった DB非依存のロジックだけを切り出してテストしやすくする。
 */

export type RankingPeriod = "day" | "week" | "month";

const PERIOD_MS: Record<RankingPeriod, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/**
 * 指定期間の集計対象の下限日時（cutoff）を求める。`now` を差し替えられるようにして
 * 境界値（ちょうど24時間前等）をテストで固定できるようにする。
 */
export function cutoffForPeriod(period: RankingPeriod, now: Date = new Date()): Date {
  return new Date(now.getTime() - PERIOD_MS[period]);
}

/** クエリパラメータ等の文字列が有効な期間指定かを判定する型ガード。 */
export function isValidRankingPeriod(value: string): value is RankingPeriod {
  return value === "day" || value === "week" || value === "month";
}

/**
 * groupBy で得た articleId の集計順序（多い順）を、記事サマリの Map と突き合わせて
 * 並び順を保った配列にする。該当するサマリが見つからない articleId
 * （閲覧イベント後に記事が保留化・削除された等）は結果からスキップし、例外にはしない。
 */
export function mapRankingOrder<T>(orderedIds: string[], byId: Map<string, T>): T[] {
  const result: T[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item) result.push(item);
  }
  return result;
}
