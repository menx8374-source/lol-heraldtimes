/**
 * 月別アーカイブ（拡張E4）の純関数テスト。月キー算出・集計・妥当性判定・日時範囲を検証する。
 */
import { describe, expect, it } from "vitest";
import {
  groupByMonth,
  isValidMonthKey,
  monthDateRange,
  monthKeyOf,
  monthLabel,
} from "@/lib/archive";

describe("isValidMonthKey", () => {
  it("YYYY-MM形式（01〜12）は有効", () => {
    expect(isValidMonthKey("2026-07")).toBe(true);
    expect(isValidMonthKey("2026-01")).toBe(true);
    expect(isValidMonthKey("2026-12")).toBe(true);
  });

  it("月が00や13以上、桁数不足・不正形式は無効", () => {
    expect(isValidMonthKey("2026-00")).toBe(false);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-7")).toBe(false);
    expect(isValidMonthKey("2026/07")).toBe(false);
    expect(isValidMonthKey("not-a-month")).toBe(false);
    expect(isValidMonthKey("")).toBe(false);
  });
});

describe("monthKeyOf / monthLabel", () => {
  it("日時から YYYY-MM キーを作る", () => {
    expect(monthKeyOf(new Date(2026, 6, 20))).toBe("2026-07"); // month index 6 = 7月
  });

  it("YYYY-MM から「YYYY年M月」表示ラベルを作る（先頭0は落とす）", () => {
    expect(monthLabel("2026-07")).toBe("2026年7月");
    expect(monthLabel("2026-12")).toBe("2026年12月");
  });
});

describe("groupByMonth", () => {
  it("月ごとに件数を集計し、新しい月が先頭に来る順で並べる", () => {
    const dates = [
      new Date(2026, 5, 1), // 2026-06
      new Date(2026, 6, 1), // 2026-07
      new Date(2026, 6, 15), // 2026-07
      new Date(2026, 6, 30), // 2026-07
    ];
    const result = groupByMonth(dates);
    expect(result).toEqual([
      { key: "2026-07", label: "2026年7月", count: 3 },
      { key: "2026-06", label: "2026年6月", count: 1 },
    ]);
  });

  it("空配列は空配列を返す", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("monthDateRange", () => {
  it("指定月の[開始, 翌月開始)の半開区間を返す", () => {
    const range = monthDateRange("2026-07");
    expect(range).not.toBeNull();
    expect(range!.start).toEqual(new Date(2026, 6, 1, 0, 0, 0, 0));
    expect(range!.end).toEqual(new Date(2026, 7, 1, 0, 0, 0, 0));
  });

  it("年をまたぐ12月は翌年1月開始を終端にする", () => {
    const range = monthDateRange("2026-12");
    expect(range!.end).toEqual(new Date(2027, 0, 1, 0, 0, 0, 0));
  });

  it("不正なキーは null を返す", () => {
    expect(monthDateRange("invalid")).toBeNull();
  });
});
