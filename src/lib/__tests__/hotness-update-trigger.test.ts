/**
 * shouldUpdateArticle / resolveBaselineMetrics（記事更新トリガ、リファクタリングS6 F-S6-1）のテスト
 * （ブリーフ テスト1）。純関数・AI不使用・DB非依存。
 */
import { describe, expect, it } from "vitest";
import { resolveBaselineMetrics, shouldUpdateArticle, type ArticleUpdateInput } from "@/lib/hotness/update-trigger";
import type { ArticleUpdateConfig } from "@/lib/hotness/config";
import type { HotnessMetricsPoint } from "@/lib/hotness/evaluator";

const CONFIG: ArticleUpdateConfig = {
  updateMinScoreDelta: 100,
  updateMinCommentDelta: 30,
  updateCooldownHours: 6,
  updateMaxCount: 2,
  updateMaxAgeHours: 48,
};

const NOW = new Date("2026-07-27T12:00:00Z");

function point(score: number, commentCount: number, capturedAt: string): HotnessMetricsPoint {
  return { score, commentCount, capturedAt: new Date(capturedAt) };
}

function baseInput(overrides: Partial<ArticleUpdateInput> = {}): ArticleUpdateInput {
  return {
    sourceType: "reddit",
    postedAt: new Date("2026-07-27T00:00:00Z"), // 12時間前(窓内)
    metricsHistory: [point(300, 60, "2026-07-27T12:00:00Z")],
    baselineScore: 100,
    baselineComments: 30,
    lastUpdatedAt: new Date("2026-07-27T00:00:00Z"), // 12時間前(cooldown6h超過)
    updateCount: 0,
    ...overrides,
  };
}

describe("shouldUpdateArticle（記事更新トリガ判定、リファクタリングS6 F-S6-1）", () => {
  it("Score増加量がupdateMinScoreDelta以上ならtrue・reason=score_surge", () => {
    // baselineScore=100, current=300 → delta=200 >= 100
    const result = shouldUpdateArticle(baseInput(), NOW, CONFIG);
    expect(result).toEqual({ shouldUpdate: true, reason: "score_surge" });
  });

  it("コメント増加量がupdateMinCommentDelta以上ならtrue・reason=comment_surge(scoreは閾値未満)", () => {
    const input = baseInput({
      metricsHistory: [point(150, 100, "2026-07-27T12:00:00Z")], // scoreDelta=50(<100)、commentDelta=70(>=30)
    });
    const result = shouldUpdateArticle(input, NOW, CONFIG);
    expect(result).toEqual({ shouldUpdate: true, reason: "comment_surge" });
  });

  it("Score・コメントともに増加量が閾値未満ならfalse・reason=null", () => {
    const input = baseInput({
      metricsHistory: [point(120, 35, "2026-07-27T12:00:00Z")], // scoreDelta=20, commentDelta=5
    });
    expect(shouldUpdateArticle(input, NOW, CONFIG)).toEqual({ shouldUpdate: false, reason: null });
  });

  it("cooldown未経過(前回更新からupdateCooldownHours未満)ならトリガ条件を満たしてもfalse", () => {
    const input = baseInput({ lastUpdatedAt: new Date("2026-07-27T08:00:00Z") }); // 4時間前(<6h)
    expect(shouldUpdateArticle(input, NOW, CONFIG)).toEqual({ shouldUpdate: false, reason: null });
  });

  it("updateCountがupdateMaxCount以上ならトリガ条件を満たしてもfalse(多重更新の歯止め)", () => {
    const input = baseInput({ updateCount: 2 });
    expect(shouldUpdateArticle(input, NOW, CONFIG)).toEqual({ shouldUpdate: false, reason: null });
  });

  it("投稿からの経過時間がupdateMaxAgeHoursを超えたらトリガ条件を満たしてもfalse", () => {
    const input = baseInput({ postedAt: new Date("2026-07-25T00:00:00Z") }); // 60時間前(>48h)
    expect(shouldUpdateArticle(input, NOW, CONFIG)).toEqual({ shouldUpdate: false, reason: null });
  });

  it("5ch: scoreは常に0のため常にscoreDelta=0で、コメント増加量のみで判定される", () => {
    const notTriggered = baseInput({
      sourceType: "5ch",
      baselineScore: 0,
      baselineComments: 20,
      metricsHistory: [point(0, 40, "2026-07-27T12:00:00Z")], // commentDelta=20(<30) → false
    });
    expect(shouldUpdateArticle(notTriggered, NOW, CONFIG).shouldUpdate).toBe(false);

    const triggered = baseInput({
      sourceType: "5ch",
      baselineScore: 0,
      baselineComments: 20,
      metricsHistory: [point(0, 60, "2026-07-27T12:00:00Z")], // commentDelta=40(>=30) → true
    });
    expect(shouldUpdateArticle(triggered, NOW, CONFIG)).toEqual({ shouldUpdate: true, reason: "comment_surge" });
  });

  it("metricsHistoryが空の場合は現在値0扱いで安全に動作する(delta負でトリガしない)", () => {
    const input = baseInput({ metricsHistory: [] });
    expect(shouldUpdateArticle(input, NOW, CONFIG)).toEqual({ shouldUpdate: false, reason: null });
  });

  it("Score・コメントの両方が閾値を超える場合はscore_surgeを優先する", () => {
    const input = baseInput({
      metricsHistory: [point(300, 100, "2026-07-27T12:00:00Z")], // scoreDelta=200, commentDelta=70
    });
    expect(shouldUpdateArticle(input, NOW, CONFIG).reason).toBe("score_surge");
  });
});

describe("resolveBaselineMetrics（baseline算出、リファクタリングS6 F-S6-1）", () => {
  it("lastUpdatedAt以前の最も新しいスナップショットをbaselineにする", () => {
    const history = [
      point(50, 10, "2026-07-27T00:00:00Z"),
      point(80, 20, "2026-07-27T06:00:00Z"), // lastUpdatedAtちょうど → これがbaseline
      point(300, 60, "2026-07-27T12:00:00Z"), // lastUpdatedAtより後 → current側(baselineに含まない)
    ];
    const baseline = resolveBaselineMetrics(history, new Date("2026-07-27T06:00:00Z"));
    expect(baseline).toEqual({ score: 80, comments: 20 });
  });

  it("lastUpdatedAt以前のスナップショットが1つも無ければ履歴の先頭(最古)にフォールバックする", () => {
    const history = [point(10, 5, "2026-07-27T10:00:00Z"), point(20, 8, "2026-07-27T11:00:00Z")];
    const baseline = resolveBaselineMetrics(history, new Date("2026-07-27T00:00:00Z")); // 履歴より前
    expect(baseline).toEqual({ score: 10, comments: 5 });
  });

  it("履歴が空なら0/0を返す", () => {
    expect(resolveBaselineMetrics([], NOW)).toEqual({ score: 0, comments: 0 });
  });
});
