/**
 * メトリクス定期更新のスケジュール設定（リファクタリングS4 F-S4-2）のテスト（ブリーフ テスト1）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  getMetricsScheduleConfig,
  isMetricsDue,
  metricsCaptureIntervalMinutes,
  type MetricsScheduleConfig,
} from "@/lib/collection/metrics-schedule";

const ENV_KEYS = [
  "METRICS_EARLY_INTERVAL_MINUTES",
  "METRICS_EARLY_PHASE_HOURS",
  "METRICS_MID_INTERVAL_MINUTES",
  "METRICS_MID_PHASE_HOURS",
  "METRICS_LATE_INTERVAL_MINUTES",
  "METRICS_LATE_PHASE_HOURS",
  "METRICS_TAIL_INTERVAL_MINUTES",
  "METRICS_MAX_MONITOR_HOURS",
  "METRICS_MAX_POSTS_PER_RUN",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("getMetricsScheduleConfig（S4 F-S4-2）", () => {
  it("既定値を返す", () => {
    expect(getMetricsScheduleConfig()).toEqual({
      earlyIntervalMinutes: 10,
      earlyPhaseHours: 1,
      midIntervalMinutes: 30,
      midPhaseHours: 6,
      lateIntervalMinutes: 120,
      latePhaseHours: 24,
      tailIntervalMinutes: 360,
      maxMonitorHours: 48,
      maxPostsPerRun: 50,
    });
  });

  it("envで各値を上書きできる", () => {
    process.env.METRICS_EARLY_INTERVAL_MINUTES = "5";
    process.env.METRICS_MAX_MONITOR_HOURS = "72";
    process.env.METRICS_MAX_POSTS_PER_RUN = "10";
    const config = getMetricsScheduleConfig();
    expect(config.earlyIntervalMinutes).toBe(5);
    expect(config.maxMonitorHours).toBe(72);
    expect(config.maxPostsPerRun).toBe(10);
  });

  it("不正な値(数値でない・負数)は既定値にフォールバックする", () => {
    process.env.METRICS_EARLY_INTERVAL_MINUTES = "not-a-number";
    process.env.METRICS_MAX_MONITOR_HOURS = "-5";
    const config = getMetricsScheduleConfig();
    expect(config.earlyIntervalMinutes).toBe(10);
    expect(config.maxMonitorHours).toBe(48);
  });
});

const CONFIG: MetricsScheduleConfig = {
  earlyIntervalMinutes: 10,
  earlyPhaseHours: 1,
  midIntervalMinutes: 30,
  midPhaseHours: 6,
  lateIntervalMinutes: 120,
  latePhaseHours: 24,
  tailIntervalMinutes: 360,
  maxMonitorHours: 48,
  maxPostsPerRun: 50,
};

describe("metricsCaptureIntervalMinutes（バックオフ間隔の帯判定、境界含む）", () => {
  it("earlyPhaseHours以内(境界含む)はearlyInterval", () => {
    expect(metricsCaptureIntervalMinutes(0, CONFIG)).toBe(10);
    expect(metricsCaptureIntervalMinutes(0.5, CONFIG)).toBe(10);
    expect(metricsCaptureIntervalMinutes(1, CONFIG)).toBe(10); // 境界
  });

  it("earlyPhaseHours超〜midPhaseHours以内(境界含む)はmidInterval", () => {
    expect(metricsCaptureIntervalMinutes(1.01, CONFIG)).toBe(30);
    expect(metricsCaptureIntervalMinutes(3, CONFIG)).toBe(30);
    expect(metricsCaptureIntervalMinutes(6, CONFIG)).toBe(30); // 境界
  });

  it("midPhaseHours超〜latePhaseHours以内(境界含む)はlateInterval", () => {
    expect(metricsCaptureIntervalMinutes(6.01, CONFIG)).toBe(120);
    expect(metricsCaptureIntervalMinutes(12, CONFIG)).toBe(120);
    expect(metricsCaptureIntervalMinutes(24, CONFIG)).toBe(120); // 境界
  });

  it("latePhaseHours超はtailInterval", () => {
    expect(metricsCaptureIntervalMinutes(24.01, CONFIG)).toBe(360);
    expect(metricsCaptureIntervalMinutes(40, CONFIG)).toBe(360);
    expect(metricsCaptureIntervalMinutes(48, CONFIG)).toBe(360);
  });
});

describe("isMetricsDue（due判定、境界含む）", () => {
  const postedAt = new Date("2026-07-27T00:00:00.000Z");

  it("前回チェックからの経過が間隔未満ならfalse", () => {
    const now = new Date("2026-07-27T00:09:00.000Z"); // ageHours=0.15 -> early(10分)
    const lastCheckedAt = new Date("2026-07-27T00:00:00.000Z");
    expect(isMetricsDue({ postedAt, lastCheckedAt }, now, CONFIG)).toBe(false);
  });

  it("前回チェックからの経過がちょうど間隔ならtrue(境界)", () => {
    const now = new Date("2026-07-27T00:10:00.000Z");
    const lastCheckedAt = new Date("2026-07-27T00:00:00.000Z");
    expect(isMetricsDue({ postedAt, lastCheckedAt }, now, CONFIG)).toBe(true);
  });

  it("前回チェックからの経過が間隔超ならtrue", () => {
    const now = new Date("2026-07-27T00:11:00.000Z");
    const lastCheckedAt = new Date("2026-07-27T00:00:00.000Z");
    expect(isMetricsDue({ postedAt, lastCheckedAt }, now, CONFIG)).toBe(true);
  });

  it("lastCheckedAtがnull(未チェック)の場合はpostedAtを基準にする", () => {
    const now = new Date("2026-07-27T00:10:00.000Z"); // postedAtから10分経過(=early間隔ちょうど)
    expect(isMetricsDue({ postedAt, lastCheckedAt: null }, now, CONFIG)).toBe(true);
    const tooSoon = new Date("2026-07-27T00:05:00.000Z");
    expect(isMetricsDue({ postedAt, lastCheckedAt: null }, tooSoon, CONFIG)).toBe(false);
  });

  it("経過帯が変わると間隔も変わる(例: mid帯は30分間隔)", () => {
    const lastCheckedAt = new Date("2026-07-27T02:00:00.000Z"); // ageHours=2 -> mid帯
    const notYetDue = new Date("2026-07-27T02:20:00.000Z"); // 20分経過(<30分)
    expect(isMetricsDue({ postedAt, lastCheckedAt }, notYetDue, CONFIG)).toBe(false);
    const due = new Date("2026-07-27T02:30:00.000Z"); // 30分経過
    expect(isMetricsDue({ postedAt, lastCheckedAt }, due, CONFIG)).toBe(true);
  });
});
