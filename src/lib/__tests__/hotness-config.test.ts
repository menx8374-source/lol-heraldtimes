import { afterEach, describe, expect, it } from "vitest";
import { getArticleUpdateConfig, getExemptSourceTypes, getHotnessConfig } from "@/lib/hotness/config";

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
  "HOTNESS_MIN_CONTROVERSY_RATIO",
  "HOTNESS_5CH_MIN_CONTROVERSY_RATIO",
  "HOTNESS_MAX_UPVOTE_RATIO",
  "HOTNESS_EXEMPT_SOURCE_TYPES",
  "UPDATE_MIN_SCORE_DELTA",
  "UPDATE_MIN_COMMENT_DELTA",
  "UPDATE_COOLDOWN_HOURS",
  "UPDATE_MAX_COUNT",
  "UPDATE_MAX_AGE_HOURS",
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
      minControversyRatio: 0.15,
      maxUpvoteRatio: 0.8,
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
      minControversyRatio: 0.15,
      maxUpvoteRatio: 0.8,
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

  it("論争度判定(成長G1 F-G1-1)の既定値はminControversyRatio=0.15・maxUpvoteRatio=0.80(reddit/汎用)", () => {
    expect(getHotnessConfig().minControversyRatio).toBe(0.15);
    expect(getHotnessConfig().maxUpvoteRatio).toBe(0.8);
    expect(getHotnessConfig("reddit").minControversyRatio).toBe(0.15);
    expect(getHotnessConfig("reddit").maxUpvoteRatio).toBe(0.8);
  });

  it("5chはminControversyRatioが実質無効(Infinity)になる(品質ゲート指摘修正: scoreが常時0のためcomment比が発散し判定として無意味なため)", () => {
    expect(getHotnessConfig("5ch").minControversyRatio).toBe(Number.POSITIVE_INFINITY);
    // maxUpvoteRatioは5chでも共通既定のまま(5chはupvoteRatioを持たないため実質使われない)
    expect(getHotnessConfig("5ch").maxUpvoteRatio).toBe(0.8);
  });

  it("5ch専用envで論争度閾値を明示的に上書きできる(既存のソース別上書きパターンを踏襲)", () => {
    process.env.HOTNESS_5CH_MIN_CONTROVERSY_RATIO = "0.5";
    expect(getHotnessConfig("5ch").minControversyRatio).toBe(0.5);
    // 他ソース・汎用には影響しない
    expect(getHotnessConfig("reddit").minControversyRatio).toBe(0.15);
    expect(getHotnessConfig().minControversyRatio).toBe(0.15);
  });

  it("5ch専用envに不正な値を設定した場合はInfinity(実質無効)にフォールバックする", () => {
    process.env.HOTNESS_5CH_MIN_CONTROVERSY_RATIO = "not-a-number";
    expect(getHotnessConfig("5ch").minControversyRatio).toBe(Number.POSITIVE_INFINITY);
  });

  it("論争度判定の閾値はenvで上書きできる", () => {
    process.env.HOTNESS_MIN_CONTROVERSY_RATIO = "0.3";
    process.env.HOTNESS_MAX_UPVOTE_RATIO = "0.6";
    const config = getHotnessConfig();
    expect(config.minControversyRatio).toBe(0.3);
    expect(config.maxUpvoteRatio).toBe(0.6);
  });

  it("論争度判定の閾値に不正な値(数値でない・負数)を設定した場合は既定値にフォールバックする", () => {
    process.env.HOTNESS_MIN_CONTROVERSY_RATIO = "not-a-number";
    process.env.HOTNESS_MAX_UPVOTE_RATIO = "-1";
    const config = getHotnessConfig();
    expect(config.minControversyRatio).toBe(0.15);
    expect(config.maxUpvoteRatio).toBe(0.8);
  });
});

describe("getExemptSourceTypes（hotness免除ソース、リファクタリング S5c F-S5c-1）", () => {
  it("既定は['riot','riot-news']（公式パッチノート・公式ニュースはhotness判定を経ずに常に記事化対象、リファクタリングS7bでriot-newsを追加）", () => {
    expect(getExemptSourceTypes()).toEqual(["riot", "riot-news"]);
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
    expect(getExemptSourceTypes()).toEqual(["riot", "riot-news"]);

    process.env.HOTNESS_EXEMPT_SOURCE_TYPES = "";
    expect(getExemptSourceTypes()).toEqual(["riot", "riot-news"]);
  });
});

describe("getArticleUpdateConfig（記事更新トリガの設定、リファクタリングS6 F-S6-1）", () => {
  it("既定値を返す", () => {
    expect(getArticleUpdateConfig()).toEqual({
      updateMinScoreDelta: 100,
      updateMinCommentDelta: 30,
      updateCooldownHours: 6,
      updateMaxCount: 2,
      updateMaxAgeHours: 48,
    });
  });

  it("envで各値を上書きできる", () => {
    process.env.UPDATE_MIN_SCORE_DELTA = "200";
    process.env.UPDATE_MIN_COMMENT_DELTA = "50";
    process.env.UPDATE_COOLDOWN_HOURS = "12";
    process.env.UPDATE_MAX_COUNT = "3";
    process.env.UPDATE_MAX_AGE_HOURS = "72";

    expect(getArticleUpdateConfig()).toEqual({
      updateMinScoreDelta: 200,
      updateMinCommentDelta: 50,
      updateCooldownHours: 12,
      updateMaxCount: 3,
      updateMaxAgeHours: 72,
    });
  });

  it("不正な値(数値でない・負数)を設定した場合は既定値にフォールバックする", () => {
    process.env.UPDATE_MIN_SCORE_DELTA = "not-a-number";
    process.env.UPDATE_MAX_COUNT = "-1";
    const config = getArticleUpdateConfig();
    expect(config.updateMinScoreDelta).toBe(100);
    expect(config.updateMaxCount).toBe(2);
  });
});
