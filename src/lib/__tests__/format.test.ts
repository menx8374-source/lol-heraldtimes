import { describe, expect, it } from "vitest";
import { formatPublishedAt } from "@/lib/format";

describe("formatPublishedAt", () => {
  it("YYYY/MM/DD HH:MM 形式に整形する", () => {
    const date = new Date(2026, 6, 20, 9, 5); // 2026-07-20 09:05 (ローカルタイム)
    expect(formatPublishedAt(date)).toBe("2026/07/20 09:05");
  });

  it("1桁の月日時分をゼロ埋めする", () => {
    const date = new Date(2026, 0, 1, 0, 0);
    expect(formatPublishedAt(date)).toBe("2026/01/01 00:00");
  });
});
