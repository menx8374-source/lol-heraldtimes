/**
 * 期間別ランキング（拡張E4）の純関数テスト。cutoff算出の境界値・並び順の突き合わせを検証する。
 */
import { describe, expect, it } from "vitest";
import { cutoffForPeriod, isValidRankingPeriod, mapRankingOrder } from "@/lib/ranking";

describe("cutoffForPeriod", () => {
  const now = new Date("2026-07-25T12:00:00Z");

  it("day は now の24時間前", () => {
    expect(cutoffForPeriod("day", now)).toEqual(new Date("2026-07-24T12:00:00Z"));
  });

  it("week は now の7日前", () => {
    expect(cutoffForPeriod("week", now)).toEqual(new Date("2026-07-18T12:00:00Z"));
  });

  it("month は now の30日前", () => {
    expect(cutoffForPeriod("month", now)).toEqual(new Date("2026-06-25T12:00:00Z"));
  });
});

describe("isValidRankingPeriod", () => {
  it("day/week/month は有効", () => {
    expect(isValidRankingPeriod("day")).toBe(true);
    expect(isValidRankingPeriod("week")).toBe(true);
    expect(isValidRankingPeriod("month")).toBe(true);
  });

  it("未知の値・空文字は無効", () => {
    expect(isValidRankingPeriod("year")).toBe(false);
    expect(isValidRankingPeriod("")).toBe(false);
    expect(isValidRankingPeriod("all")).toBe(false);
  });
});

describe("mapRankingOrder", () => {
  it("集計順（多い順）を保ったまま記事サマリの配列に変換する", () => {
    const byId = new Map([
      ["id-a", { slug: "a", title: "記事A" }],
      ["id-b", { slug: "b", title: "記事B" }],
      ["id-c", { slug: "c", title: "記事C" }],
    ]);
    const result = mapRankingOrder(["id-c", "id-a", "id-b"], byId);
    expect(result.map((r) => r.slug)).toEqual(["c", "a", "b"]);
  });

  it("Mapに存在しないidはスキップし、例外を投げない", () => {
    const byId = new Map([["id-a", { slug: "a", title: "記事A" }]]);
    expect(() => mapRankingOrder(["id-missing", "id-a"], byId)).not.toThrow();
    expect(mapRankingOrder(["id-missing", "id-a"], byId).map((r) => r.slug)).toEqual(["a"]);
  });

  it("空の順序配列は空配列を返す", () => {
    expect(mapRankingOrder([], new Map())).toEqual([]);
  });
});
