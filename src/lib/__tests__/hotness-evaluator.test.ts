import { describe, expect, it } from "vitest";
import { evaluateHotness, type HotnessMetricsPoint } from "@/lib/hotness/evaluator";
import { getHotnessConfig, type HotnessConfig } from "@/lib/hotness/config";

/** テスト用の基準config(既定値相当)。個別テストで必要なフィールドだけ上書きする。 */
const BASE_CONFIG: HotnessConfig = {
  minScore: 100,
  minComments: 30,
  minScoreGrowthPerHour: 50,
  minCommentGrowthPerHour: 10,
  minAgeMinutes: 30,
  maxAgeHours: 72,
  useRankSignal: false,
};

const NOW = new Date("2026-07-27T12:00:00Z");

function point(score: number, commentCount: number, capturedAt: string): HotnessMetricsPoint {
  return { score, commentCount, capturedAt: new Date(capturedAt) };
}

describe("evaluateHotness（話題性のルールベース判定、リファクタリングS3 F-S3-2、AI不使用・純関数・未結線）", () => {
  it("現在値が閾値超なら経過時間窓内でisHot=trueになり、reasonsに現在値超が含まれる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"), // 2時間前(窓内)
        metricsHistory: [point(150, 40, "2026-07-27T12:00:00Z")],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(true);
    expect(result.reasons.some((r) => r.includes("現在値"))).toBe(true);
    expect(result.metrics.score).toBe(150);
    expect(result.metrics.comments).toBe(40);
    expect(result.metrics.ageMinutes).toBeCloseTo(120, 5);
  });

  it("現在値は閾値未満でも増加率(score)が閾値超ならisHot=trueになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [
          point(10, 5, "2026-07-27T11:00:00Z"), // 1時間前
          point(70, 8, "2026-07-27T12:00:00Z"), // 現在: score60増加/1時間 = 60/h > 50/h閾値
        ],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.metrics.scoreGrowthPerHour).toBeCloseTo(60, 5);
    expect(result.isHot).toBe(true);
    expect(result.reasons.some((r) => r.includes("スコア増加率"))).toBe(true);
  });

  it("現在値は閾値未満でも増加率(コメント)が閾値超ならisHot=trueになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "5ch",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [
          point(0, 5, "2026-07-27T11:00:00Z"),
          point(0, 20, "2026-07-27T12:00:00Z"), // コメント15増加/1時間 = 15/h > 10/h閾値
        ],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.metrics.commentGrowthPerHour).toBeCloseTo(15, 5);
    expect(result.isHot).toBe(true);
    expect(result.reasons.some((r) => r.includes("コメント増加率"))).toBe(true);
  });

  it("現在値・増加率ともに閾値未満ならisHot=falseでreasonsは空になる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(10, 5, "2026-07-27T11:00:00Z"), point(15, 6, "2026-07-27T12:00:00Z")],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("経過時間がminAgeMinutes未満(新しすぎる)場合は現在値が閾値超でもisHot=falseになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T11:50:00Z"), // 10分前(minAgeMinutes=30未満)
        metricsHistory: [point(500, 200, "2026-07-27T12:00:00Z")],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(false);
    expect(result.reasons[0]).toContain("経過時間");
  });

  it("経過時間がmaxAgeHoursを超える(古すぎる)場合は現在値が閾値超でもisHot=falseになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-20T12:00:00Z"), // 7日前(maxAgeHours=72時間=3日を超過)
        metricsHistory: [point(500, 200, "2026-07-27T12:00:00Z")],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(false);
    expect(result.reasons[0]).toContain("経過時間");
  });

  it("履歴が1点のみの場合は増加率0扱いになり、現在値ルールのみで判定される", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(150, 40, "2026-07-27T12:00:00Z")],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.metrics.scoreGrowthPerHour).toBe(0);
    expect(result.metrics.commentGrowthPerHour).toBe(0);
    expect(result.isHot).toBe(true); // 現在値ルールで満たす
  });

  it("履歴が空の場合はscore/comments=0・増加率0で安全に動作し、閾値が正ならisHot=falseになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.metrics.score).toBe(0);
    expect(result.metrics.comments).toBe(0);
    expect(result.metrics.scoreGrowthPerHour).toBe(0);
    expect(result.metrics.commentGrowthPerHour).toBe(0);
    expect(result.isHot).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("ソース差: 5ch用config(getHotnessConfig('5ch')、minScore=0)ではscore=0でもコメント数が閾値超なら現在値ルールでhotになる", () => {
    const config = getHotnessConfig("5ch");
    const result = evaluateHotness(
      {
        sourceType: "5ch",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(0, 40, "2026-07-27T12:00:00Z")], // 5chはscoreが常に0
      },
      NOW,
      config,
    );
    expect(result.isHot).toBe(true);
    expect(result.reasons.some((r) => r.includes("現在値"))).toBe(true);
  });

  it("ソース差: reddit用config(getHotnessConfig('reddit')、minScore=100)ではscore=0だとコメント数だけでは現在値ルールを満たさない", () => {
    const config = getHotnessConfig("reddit");
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(0, 40, "2026-07-27T12:00:00Z")],
      },
      NOW,
      config,
    );
    expect(result.isHot).toBe(false);
  });
});
