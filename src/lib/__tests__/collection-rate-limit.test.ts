import { describe, expect, it } from "vitest";
import { capItems, isRateLimited } from "@/lib/collection/rate-limit";

describe("isRateLimited", () => {
  it("前回実行が無い(null)場合は制限しない", () => {
    expect(isRateLimited(null, new Date("2026-07-25T10:00:00Z"), 10 * 60 * 1000)).toBe(false);
  });

  it("最小間隔未満しか経過していない場合は制限中と判定する", () => {
    const lastRunAt = new Date("2026-07-25T10:00:00Z");
    const now = new Date("2026-07-25T10:05:00Z"); // 5分後
    expect(isRateLimited(lastRunAt, now, 10 * 60 * 1000)).toBe(true); // 最小間隔10分
  });

  it("最小間隔以上経過していれば制限しない", () => {
    const lastRunAt = new Date("2026-07-25T10:00:00Z");
    const now = new Date("2026-07-25T10:10:00Z"); // ちょうど10分後
    expect(isRateLimited(lastRunAt, now, 10 * 60 * 1000)).toBe(false);
  });
});

describe("capItems", () => {
  it("上限件数を超える配列を切り詰める", () => {
    expect(capItems([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it("上限件数以下の配列はそのまま返す", () => {
    expect(capItems([1, 2], 5)).toEqual([1, 2]);
  });

  it("上限0では空配列になる", () => {
    expect(capItems([1, 2, 3], 0)).toEqual([]);
  });
});
