/**
 * nextPublishSlots（成長G6 F-G6-1）の単体テスト（ブリーフ テスト1）。
 * 公開スロット(07:15/12:15/15:15/18:15/21:15 JST)からの割当・翌日繰り越し・TZ非依存を検証する。
 * DB非依存の純関数のため、実DBを使わず高速に検証できる。
 */
import { describe, expect, it, afterEach } from "vitest";
import { nextPublishSlots } from "@/lib/generation/publish-schedule";

describe("nextPublishSlots（成長G6 F-G6-1）", () => {
  afterEach(() => {
    delete process.env.TZ;
  });

  it("countが0以下なら空配列を返す", () => {
    expect(nextPublishSlots(new Date("2026-07-27T00:00:00.000Z"), 0)).toEqual([]);
    expect(nextPublishSlots(new Date("2026-07-27T00:00:00.000Z"), -1)).toEqual([]);
  });

  it("now以降の同日中の残りスロットから昇順でcount個返す(JST09:00→12:15/15:15/18:15)", () => {
    const now = new Date("2026-07-27T00:00:00.000Z"); // JST 2026-07-27 09:00
    const slots = nextPublishSlots(now, 3);
    expect(slots.map((d) => d.toISOString())).toEqual([
      "2026-07-27T03:15:00.000Z", // JST 12:15
      "2026-07-27T06:15:00.000Z", // JST 15:15
      "2026-07-27T09:15:00.000Z", // JST 18:15
    ]);
  });

  it("同日のスロットが尽きたら翌日の先頭スロット(07:15 JST)へ繰り越す(1スロット1件)", () => {
    const now = new Date("2026-07-27T00:00:00.000Z"); // JST 2026-07-27 09:00
    const slots = nextPublishSlots(now, 5);
    expect(slots.map((d) => d.toISOString())).toEqual([
      "2026-07-27T03:15:00.000Z", // JST 07-27 12:15
      "2026-07-27T06:15:00.000Z", // JST 07-27 15:15
      "2026-07-27T09:15:00.000Z", // JST 07-27 18:15
      "2026-07-27T12:15:00.000Z", // JST 07-27 21:15
      "2026-07-27T22:15:00.000Z", // JST 07-28 07:15 (翌日繰り越し)
    ]);
  });

  it("境界時刻: nowがスロット時刻ちょうどのとき、そのスロット自身を含む(以上判定)", () => {
    const now = new Date("2026-07-27T22:15:00.000Z"); // JST 2026-07-28 07:15 ちょうど
    const slots = nextPublishSlots(now, 1);
    expect(slots[0].toISOString()).toBe("2026-07-27T22:15:00.000Z");
  });

  it("その日の全スロットが経過済みなら翌日の先頭スロットへ繰り越す", () => {
    const now = new Date("2026-07-27T13:00:00.000Z"); // JST 2026-07-27 22:00（21:15スロットも経過済み）
    const slots = nextPublishSlots(now, 1);
    expect(slots[0].toISOString()).toBe("2026-07-27T22:15:00.000Z"); // JST 07-28 07:15
  });

  it("TZ非依存: process.env.TZを変えても結果が変わらない", () => {
    const now = new Date("2026-07-27T00:00:00.000Z");
    const baseline = nextPublishSlots(now, 5).map((d) => d.toISOString());

    for (const tz of ["America/New_York", "Europe/London", "Asia/Kolkata", "UTC"]) {
      process.env.TZ = tz;
      const result = nextPublishSlots(now, 5).map((d) => d.toISOString());
      expect(result).toEqual(baseline);
    }
  });
});
