/**
 * ソースごとの取得件数上限・実行間隔（レート制限）判定の純関数（F5）。
 */

/**
 * 前回実行時刻 `lastRunAt` から `minIntervalMs` 未満しか経過していない場合はレート制限中とみなす。
 * `lastRunAt` が null（初回実行）の場合は制限しない。
 */
export function isRateLimited(lastRunAt: Date | null, now: Date, minIntervalMs: number): boolean {
  if (!lastRunAt) return false;
  return now.getTime() - lastRunAt.getTime() < minIntervalMs;
}

/** 配列を上限件数で切り詰める（負値は0件扱い）。 */
export function capItems<T>(items: T[], max: number): T[] {
  return items.slice(0, Math.max(0, max));
}
