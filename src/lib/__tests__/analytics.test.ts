import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getGaMeasurementId, shouldLoadAnalytics } from "@/lib/analytics";

describe("getGaMeasurementId", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("未設定時はundefinedを返す", () => {
    expect(getGaMeasurementId()).toBeUndefined();
  });

  it("空白のみもundefinedとして扱う", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "   ";
    expect(getGaMeasurementId()).toBeUndefined();
  });

  it("設定済みの値をtrimして返す", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "  G-ABC1234  ";
    expect(getGaMeasurementId()).toBe("G-ABC1234");
  });
});

describe("shouldLoadAnalytics（同意前トラッキング禁止の判定）", () => {
  it("同意済み かつ 計測ID設定済みのときのみ読み込む", () => {
    expect(shouldLoadAnalytics(true, "G-ABC1234")).toBe(true);
  });

  it("未同意なら計測IDが設定されていても読み込まない", () => {
    expect(shouldLoadAnalytics(false, "G-ABC1234")).toBe(false);
  });

  it("同意済みでも計測ID未設定なら読み込まない", () => {
    expect(shouldLoadAnalytics(true, undefined)).toBe(false);
  });

  it("未同意かつ計測ID未設定でも読み込まない", () => {
    expect(shouldLoadAnalytics(false, undefined)).toBe(false);
  });
});
