import { afterEach, describe, expect, it } from "vitest";
import { getExemptSourceTypes, getHotnessConfig } from "@/lib/hotness/config";

const ENV_KEYS = [
  "HOTNESS_MIN_SCORE",
  "HOTNESS_MIN_COMMENTS",
  "HOTNESS_5CH_MIN_SCORE",
  "HOTNESS_5CH_MIN_COMMENTS",
  "HOTNESS_REDDIT_MIN_SCORE",
  "HOTNESS_REDDIT_MIN_COMMENTS",
  "HOTNESS_RIOT_MIN_SCORE",
  "HOTNESS_RIOT_MIN_COMMENTS",
  "HOTNESS_MIN_SCORE_GROWTH_PER_HOUR",
  "HOTNESS_MIN_COMMENT_GROWTH_PER_HOUR",
  "HOTNESS_MIN_AGE_MINUTES",
  "HOTNESS_MAX_AGE_HOURS",
  "HOTNESS_USE_RANK_SIGNAL",
  "HOTNESS_EXEMPT_SOURCE_TYPES",
];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("getHotnessConfig（話題性判定の設定ファイル、リファクタリングS3 F-S3-1）", () => {
  it("sourceType省略時は汎用既定値を返す", () => {
    const config = getHotnessConfig();
    expect(config).toEqual({
      minScore: 100,
      minComments: 30,
      minScoreGrowthPerHour: 50,
      minCommentGrowthPerHour: 10,
      minAgeMinutes: 30,
      maxAgeHours: 72,
      useRankSignal: false,
    });
  });

  it("reddit・riotは汎用と同じ既定(score主体)、5chはscore=0のcomment主体既定になる(ソース差の吸収)", () => {
    expect(getHotnessConfig("reddit").minScore).toBe(100);
    expect(getHotnessConfig("reddit").minComments).toBe(30);
    expect(getHotnessConfig("riot").minScore).toBe(100);
    expect(getHotnessConfig("5ch").minScore).toBe(0);
    expect(getHotnessConfig("5ch").minComments).toBe(30);
  });

  it("envで汎用既定値を上書きできる", () => {
    process.env.HOTNESS_MIN_SCORE = "200";
    process.env.HOTNESS_MIN_COMMENTS = "60";
    process.env.HOTNESS_MIN_SCORE_GROWTH_PER_HOUR = "80";
    process.env.HOTNESS_MIN_COMMENT_GROWTH_PER_HOUR = "20";
    process.env.HOTNESS_MIN_AGE_MINUTES = "15";
    process.env.HOTNESS_MAX_AGE_HOURS = "48";
    process.env.HOTNESS_USE_RANK_SIGNAL = "true";

    const config = getHotnessConfig();
    expect(config).toEqual({
      minScore: 200,
      minComments: 60,
      minScoreGrowthPerHour: 80,
      minCommentGrowthPerHour: 20,
      minAgeMinutes: 15,
      maxAgeHours: 48,
      useRankSignal: true,
    });
  });

  it("ソース別envで個別に上書きできる(他ソースには影響しない)", () => {
    process.env.HOTNESS_5CH_MIN_COMMENTS = "50";
    process.env.HOTNESS_REDDIT_MIN_SCORE = "300";

    expect(getHotnessConfig("5ch").minComments).toBe(50);
    expect(getHotnessConfig("5ch").minScore).toBe(0); // 5chのminScoreは既定のまま(上書きしていない)
    expect(getHotnessConfig("reddit").minScore).toBe(300);
    expect(getHotnessConfig("reddit").minComments).toBe(30); // redditのminCommentsは既定のまま
    // 汎用既定(sourceType省略)には影響しない
    expect(getHotnessConfig().minScore).toBe(100);
  });

  it("不正な値(数値でない・負数)を設定した場合は既定値にフォールバックする", () => {
    process.env.HOTNESS_MIN_SCORE = "not-a-number";
    process.env.HOTNESS_MIN_AGE_MINUTES = "-5";
    const config = getHotnessConfig();
    expect(config.minScore).toBe(100);
    expect(config.minAgeMinutes).toBe(30);
  });
});

describe("getExemptSourceTypes（hotness免除ソース、リファクタリング S5c F-S5c-1）", () => {
  it("既定は['riot']（公式パッチノートはhotness判定を経ずに常に記事化対象）", () => {
    expect(getExemptSourceTypes()).toEqual(["riot"]);
  });

  it("envでカンマ区切り上書きできる（前後空白除去）", () => {
    process.env.HOTNESS_EXEMPT_SOURCE_TYPES = " reddit, 5ch ";
    expect(getExemptSourceTypes()).toEqual(["reddit", "5ch"]);
  });

  it("envに無効なSourceTypeが混じっていれば無視し、有効な値のみ残す", () => {
    process.env.HOTNESS_EXEMPT_SOURCE_TYPES = "riot,not-a-source-type";
    expect(getExemptSourceTypes()).toEqual(["riot"]);
  });

  it("envが空文字列・有効な値が1つも無い場合は既定値にフォールバックする", () => {
    process.env.HOTNESS_EXEMPT_SOURCE_TYPES = "not-a-source-type";
    expect(getExemptSourceTypes()).toEqual(["riot"]);

    process.env.HOTNESS_EXEMPT_SOURCE_TYPES = "";
    expect(getExemptSourceTypes()).toEqual(["riot"]);
  });
});
