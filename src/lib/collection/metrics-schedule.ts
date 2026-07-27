/**
 * メトリクス定期更新のスケジュール設定（バックオフ方式、リファクタリングS4 F-S4-2）。
 * 監視中の Post を経過時間帯（early/mid/late/tail）ごとに異なる間隔で再チェックし、
 * 一定時間（maxMonitorHours）を超えたら監視を終了する。cronのゆらぎに強いバックオフ方式
 * （前回チェックからの経過時間で判定）を採用する。
 * 秘密情報ではないため `.env.example` にキー名・既定値を記載する（hotness/config.ts と同じ envInt方式）。
 */

export type MetricsScheduleConfig = {
  /** 経過0〜earlyPhaseHours時間の間隔（分）。 */
  earlyIntervalMinutes: number;
  /** early帯の境界（時間）。 */
  earlyPhaseHours: number;
  /** 経過earlyPhaseHours〜midPhaseHours時間の間隔（分）。 */
  midIntervalMinutes: number;
  /** mid帯の境界（時間、投稿からの絶対経過時間）。 */
  midPhaseHours: number;
  /** 経過midPhaseHours〜latePhaseHours時間の間隔（分）。 */
  lateIntervalMinutes: number;
  /** late帯の境界（時間、投稿からの絶対経過時間）。 */
  latePhaseHours: number;
  /** 経過latePhaseHours〜maxMonitorHours時間（tail帯）の間隔（分）。 */
  tailIntervalMinutes: number;
  /** これを超えたら監視終了（時間）。 */
  maxMonitorHours: number;
  /** 1回のupdater実行で更新する最大Post数（API有界化）。 */
  maxPostsPerRun: number;
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** メトリクス更新スケジュール設定を返す（env上書き可能）。 */
export function getMetricsScheduleConfig(): MetricsScheduleConfig {
  return {
    earlyIntervalMinutes: envInt("METRICS_EARLY_INTERVAL_MINUTES", 10),
    earlyPhaseHours: envInt("METRICS_EARLY_PHASE_HOURS", 1),
    midIntervalMinutes: envInt("METRICS_MID_INTERVAL_MINUTES", 30),
    midPhaseHours: envInt("METRICS_MID_PHASE_HOURS", 6),
    lateIntervalMinutes: envInt("METRICS_LATE_INTERVAL_MINUTES", 120),
    latePhaseHours: envInt("METRICS_LATE_PHASE_HOURS", 24),
    tailIntervalMinutes: envInt("METRICS_TAIL_INTERVAL_MINUTES", 360),
    maxMonitorHours: envInt("METRICS_MAX_MONITOR_HOURS", 48),
    maxPostsPerRun: envInt("METRICS_MAX_POSTS_PER_RUN", 50),
  };
}

/**
 * 経過時間（時間）に応じたキャプチャ間隔（分）を返す純関数（バックオフ、F-S4-2）。
 * `earlyPhaseHours`/`midPhaseHours`/`latePhaseHours` は投稿からの絶対経過時間の境界（累積ではない）。
 * 境界値そのもの（例: ちょうどearlyPhaseHours）はその帯に含める（<=）。
 */
export function metricsCaptureIntervalMinutes(ageHours: number, config: MetricsScheduleConfig): number {
  if (ageHours <= config.earlyPhaseHours) return config.earlyIntervalMinutes;
  if (ageHours <= config.midPhaseHours) return config.midIntervalMinutes;
  if (ageHours <= config.latePhaseHours) return config.lateIntervalMinutes;
  return config.tailIntervalMinutes;
}

export type MetricsDueInput = {
  postedAt: Date;
  /** 未チェック（null）の場合は postedAt を最終チェック時刻とみなす。 */
  lastCheckedAt: Date | null;
};

/**
 * 現在時刻 `now` の時点で、当該Postのメトリクスを再取得すべきか（due）を判定する純関数（F-S4-2）。
 * 「前回チェックからの経過時間 >= 現在の経過帯に応じたキャプチャ間隔」で判定する（バックオフ）。
 */
export function isMetricsDue(post: MetricsDueInput, now: Date, config: MetricsScheduleConfig): boolean {
  const ageHours = (now.getTime() - post.postedAt.getTime()) / 3600000;
  const intervalMinutes = metricsCaptureIntervalMinutes(ageHours, config);
  const lastChecked = post.lastCheckedAt ?? post.postedAt;
  const elapsedMinutesSinceCheck = (now.getTime() - lastChecked.getTime()) / 60000;
  return elapsedMinutesSinceCheck >= intervalMinutes;
}
