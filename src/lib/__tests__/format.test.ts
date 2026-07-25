import { describe, expect, it } from "vitest";
import { formatPublishedAt, formatRelativeTime } from "@/lib/format";

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

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-25T12:00:00+09:00");

  it("1分未満は「たった今」", () => {
    const date = new Date(now.getTime() - 30_000);
    expect(formatRelativeTime(date, now)).toBe("たった今");
  });

  it("1時間未満は「N分前」", () => {
    const date = new Date(now.getTime() - 5 * 60_000);
    expect(formatRelativeTime(date, now)).toBe("5分前");
  });

  it("24時間未満は「N時間前」", () => {
    const date = new Date(now.getTime() - 3 * 60 * 60_000);
    expect(formatRelativeTime(date, now)).toBe("3時間前");
  });

  it("30日未満は「N日前」", () => {
    const date = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
    expect(formatRelativeTime(date, now)).toBe("2日前");
  });

  it("30日以上前は絶対日時表記にフォールバックする", () => {
    const date = new Date(now.getTime() - 40 * 24 * 60 * 60_000);
    expect(formatRelativeTime(date, now)).toBe(formatPublishedAt(date));
  });

  it("未来日時（クロックスキュー）は負にならず「たった今」に丸める", () => {
    const date = new Date(now.getTime() + 60_000);
    expect(formatRelativeTime(date, now)).toBe("たった今");
  });
});
