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
  minControversyRatio: 0.15,
  maxUpvoteRatio: 0.8,
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

  it("現在値・増加率ともに閾値未満ならisHot=falseでreasonsは空になる（論争度も閾値未満で非controversial）", () => {
    // score/commentsは、controversyScore(=comments/max(score,1))も0.15未満に収まる値にする
    // (成長G1: isControversialはisHotと独立の判定のため、意図せず論争条件を満たさないよう選定)。
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(80, 5, "2026-07-27T11:00:00Z"), point(90, 6, "2026-07-27T12:00:00Z")],
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(false);
    expect(result.isControversial).toBe(false);
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

describe("evaluateHotness の論争度判定（isControversial/controversyScore、成長G1 F-G1-2、AI不使用）", () => {
  it("comments/score比(controversyScore)が閾値(0.15)超ならisControversial=trueになり、値も正しい", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"), // 窓内
        metricsHistory: [point(100, 30, "2026-07-27T12:00:00Z")], // 30/100=0.3 >= 0.15
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.controversyScore).toBeCloseTo(0.3, 5);
    expect(result.isControversial).toBe(true);
    expect(result.reasons.some((r) => r.includes("コメント/スコア比"))).toBe(true);
  });

  it("controversyScoreが閾値未満でもupvote_ratioが閾値(0.80)以下ならisControversial=trueになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(1000, 30, "2026-07-27T12:00:00Z")], // 30/1000=0.03 < 0.15
        upvoteRatio: 0.6, // <= 0.80
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.controversyScore).toBeLessThan(0.15);
    expect(result.isControversial).toBe(true);
    expect(result.reasons.some((r) => r.includes("upvote_ratio"))).toBe(true);
  });

  it("controversyScoreもupvote_ratioも閾値を満たさなければisControversial=falseになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(1000, 30, "2026-07-27T12:00:00Z")], // 0.03 < 0.15
        upvoteRatio: 0.95, // > 0.80
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isControversial).toBe(false);
  });

  it("upvoteRatio未指定時はcontroversyScore(コメント/スコア比)だけで判定される", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(1000, 30, "2026-07-27T12:00:00Z")], // 0.03 < 0.15, upvoteRatio未指定
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isControversial).toBe(false);
  });

  it("isControversialはisHotと独立: 経過時間窓外でisHot=falseでもisControversialは論争条件を満たせばtrueになる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T11:50:00Z"), // 10分前(窓外)
        metricsHistory: [point(100, 30, "2026-07-27T12:00:00Z")], // 0.3 >= 0.15
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(false);
    expect(result.isControversial).toBe(true);
    expect(result.reasons.some((r) => r.includes("コメント/スコア比"))).toBe(true);
  });

  it("isControversialはisHotを置き換えない: isHot=trueでもisControversial=falseになりうる", () => {
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(1000, 30, "2026-07-27T12:00:00Z")], // 現在値ルールでisHot=true、比率は低い
        upvoteRatio: 0.95,
      },
      NOW,
      BASE_CONFIG,
    );
    expect(result.isHot).toBe(true);
    expect(result.isControversial).toBe(false);
  });

  it("品質ゲート指摘修正: 5ch(score常時0)ではgetHotnessConfig('5ch')のminControversyRatioがInfinityになり、comment数がいくら多くてもisControversial=falseになる", () => {
    const config = getHotnessConfig("5ch");
    const result = evaluateHotness(
      {
        sourceType: "5ch",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(0, 30, "2026-07-27T12:00:00Z")], // score=0, comments=30(既定minComments収集数)
        // 5chはupvote_ratioを持たない(undefined)
      },
      NOW,
      config,
    );
    expect(result.controversyScore).toBe(30); // 30/max(0,1)=30と発散するが
    expect(result.isControversial).toBe(false); // config側でminControversyRatio=Infinityのため常にfalse
  });

  it("reddit(getHotnessConfig('reddit'))はcomment比高でisControversial=trueのまま(既定0.15を維持)", () => {
    const config = getHotnessConfig("reddit");
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(100, 30, "2026-07-27T12:00:00Z")], // 30/100=0.3 >= 0.15
      },
      NOW,
      config,
    );
    expect(result.isControversial).toBe(true);
  });

  it("reddit(getHotnessConfig('reddit'))はupvote_ratio低でもisControversial=trueのまま(既定0.80を維持)", () => {
    const config = getHotnessConfig("reddit");
    const result = evaluateHotness(
      {
        sourceType: "reddit",
        postedAt: new Date("2026-07-27T10:00:00Z"),
        metricsHistory: [point(1000, 30, "2026-07-27T12:00:00Z")], // comment比は低い(0.03)
        upvoteRatio: 0.6, // <= 0.80
      },
      NOW,
      config,
    );
    expect(result.isControversial).toBe(true);
  });
});
