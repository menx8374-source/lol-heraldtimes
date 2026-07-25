/**
 * カレンダー式アーカイブ（拡張E10）の純関数テスト。
 * JST日付キー化・日付バリデーション・日範囲・月グリッド生成・前後月キーを検証する。
 */
import { describe, expect, it } from "vitest";
import {
  buildMonthCalendar,
  dateLabel,
  dayDateRangeJST,
  dayKeyOfJST,
  groupByDayJST,
  isValidDateKey,
  monthDateRangeJST,
  nextMonthKey,
  prevMonthKey,
  todayMonthKeyJST,
} from "@/lib/archive";

describe("dayKeyOfJST（UTCインスタント→JST暦日）", () => {
  it("UTC深夜(15:30Z)はJSTでは翌日0:30になり、日付が繰り上がる", () => {
    // UTC 2026-07-24T15:30:00Z = JST 2026-07-25 00:30
    const date = new Date("2026-07-24T15:30:00Z");
    expect(dayKeyOfJST(date)).toBe("2026-07-25");
  });

  it("JST日境界の直前(UTC 14:59:59Z = JST 23:59:59)は前日のまま", () => {
    const date = new Date("2026-07-24T14:59:59Z");
    expect(dayKeyOfJST(date)).toBe("2026-07-24");
  });

  it("JST日境界ちょうど(UTC 15:00:00Z = JST 翌日0:00:00)は翌日になる", () => {
    const date = new Date("2026-07-24T15:00:00Z");
    expect(dayKeyOfJST(date)).toBe("2026-07-25");
  });
});

describe("isValidDateKey", () => {
  it("実在するYYYY-MM-DDは有効", () => {
    expect(isValidDateKey("2026-07-25")).toBe(true);
    expect(isValidDateKey("2024-02-29")).toBe(true); // うるう年
  });

  it("存在しない暦日・不正形式は無効", () => {
    expect(isValidDateKey("2026-02-30")).toBe(false); // 2月30日は存在しない
    expect(isValidDateKey("2023-02-29")).toBe(false); // 平年のうるう日
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("2026-07-32")).toBe(false);
    expect(isValidDateKey("2026-7-25")).toBe(false);
    expect(isValidDateKey("not-a-date")).toBe(false);
    expect(isValidDateKey("")).toBe(false);
  });
});

describe("dateLabel", () => {
  it("YYYY-MM-DDから「YYYY年M月D日」表示ラベルを作る（先頭0は落とす）", () => {
    expect(dateLabel("2026-07-05")).toBe("2026年7月5日");
    expect(dateLabel("2026-12-25")).toBe("2026年12月25日");
  });

  it("不正なキーはそのまま返す", () => {
    expect(dateLabel("invalid")).toBe("invalid");
  });
});

describe("dayDateRangeJST", () => {
  it("指定日のJST[0:00, 翌日0:00)をUTCインスタントの半開区間で返す", () => {
    const range = dayDateRangeJST("2026-07-25");
    expect(range).not.toBeNull();
    expect(range!.start.toISOString()).toBe("2026-07-24T15:00:00.000Z");
    expect(range!.end.toISOString()).toBe("2026-07-25T15:00:00.000Z");
  });

  it("不正なキーはnullを返す", () => {
    expect(dayDateRangeJST("invalid")).toBeNull();
  });
});

describe("monthDateRangeJST", () => {
  it("指定月のJST[月初0:00, 翌月0:00)をUTCインスタントの半開区間で返す", () => {
    const range = monthDateRangeJST("2026-07");
    expect(range).not.toBeNull();
    expect(range!.start.toISOString()).toBe("2026-06-30T15:00:00.000Z");
    expect(range!.end.toISOString()).toBe("2026-07-31T15:00:00.000Z");
  });

  it("不正なキーはnullを返す", () => {
    expect(monthDateRangeJST("invalid")).toBeNull();
  });
});

describe("groupByDayJST", () => {
  it("UTC深夜またぎの日付もJST暦日で正しく束ねる", () => {
    const dates = [
      new Date("2026-07-24T15:30:00Z"), // JST 2026-07-25 00:30
      new Date("2026-07-25T10:00:00Z"), // JST 2026-07-25 19:00
      new Date("2026-07-24T10:00:00Z"), // JST 2026-07-24 19:00
    ];
    const result = groupByDayJST(dates);
    expect(result.get("2026-07-25")).toBe(2);
    expect(result.get("2026-07-24")).toBe(1);
  });

  it("空配列は空マップを返す", () => {
    expect(groupByDayJST([]).size).toBe(0);
  });
});

describe("prevMonthKey / nextMonthKey", () => {
  it("通常の月内の前後月を返す", () => {
    expect(prevMonthKey("2026-07")).toBe("2026-06");
    expect(nextMonthKey("2026-07")).toBe("2026-08");
  });

  it("年をまたぐ場合も正しく計算する", () => {
    expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });
});

describe("todayMonthKeyJST", () => {
  it("UTC深夜またぎの現在時刻でもJSTの月を返す", () => {
    // UTC 2026-07-31T15:30:00Z = JST 2026-08-01 00:30
    expect(todayMonthKeyJST(new Date("2026-07-31T15:30:00Z"))).toBe("2026-08");
  });
});

describe("buildMonthCalendar", () => {
  it("不正な月キーは空配列を返す", () => {
    expect(buildMonthCalendar("invalid")).toEqual([]);
  });

  it("7の倍数長のセル配列を生成し、日1〜月末日を過不足なく含む", () => {
    const cells = buildMonthCalendar("2026-07");
    expect(cells.length % 7).toBe(0);

    const dayCells = cells.filter((c) => c.date !== null);
    expect(dayCells).toHaveLength(31); // 2026年7月は31日
    expect(dayCells[0].date).toBe("2026-07-01");
    expect(dayCells[0].day).toBe(1);
    expect(dayCells[dayCells.length - 1].date).toBe("2026-07-31");
    expect(dayCells[dayCells.length - 1].day).toBe(31);

    // 2026-07-01は水曜日(getUTCDay()===3)なので、先頭に3つのパディングセルが入る
    const firstDayIndex = cells.findIndex((c) => c.date === "2026-07-01");
    expect(firstDayIndex).toBe(3);
    for (let i = 0; i < firstDayIndex; i++) {
      expect(cells[i]).toEqual({ date: null, day: null, count: 0 });
    }
  });

  it("dayCountsで渡した件数をセルに反映し、渡さなかった日は0件になる", () => {
    const dayCounts = new Map([["2026-07-15", 3]]);
    const cells = buildMonthCalendar("2026-07", dayCounts);
    const day15 = cells.find((c) => c.date === "2026-07-15");
    const day16 = cells.find((c) => c.date === "2026-07-16");
    expect(day15?.count).toBe(3);
    expect(day16?.count).toBe(0);
  });
});
