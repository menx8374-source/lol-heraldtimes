/**
 * pbe-x-rate-limit.ts（PBE-S5 F-PBE5-1、コスト安全設計）の単体テスト。
 * ファイルI/Oは一時ディレクトリ配下の専用パスを使い、本番の`data/`配下には一切書き込まない。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getPbeXMinIntervalHours,
  isPbeXRateLimited,
  readLastPbeXFetchAt,
  writeLastPbeXFetchAt,
} from "@/lib/generation/pbe-x-rate-limit";

describe("getPbeXMinIntervalHours（env `PBE_X_MIN_INTERVAL_HOURS`）", () => {
  afterEach(() => {
    delete process.env.PBE_X_MIN_INTERVAL_HOURS;
  });

  it("未設定なら既定6時間", () => {
    delete process.env.PBE_X_MIN_INTERVAL_HOURS;
    expect(getPbeXMinIntervalHours()).toBe(6);
  });

  it("設定値をそのまま数値として使う", () => {
    process.env.PBE_X_MIN_INTERVAL_HOURS = "12";
    expect(getPbeXMinIntervalHours()).toBe(12);
  });

  it("0以下・不正値は既定6時間にフォールバックする", () => {
    process.env.PBE_X_MIN_INTERVAL_HOURS = "0";
    expect(getPbeXMinIntervalHours()).toBe(6);
    process.env.PBE_X_MIN_INTERVAL_HOURS = "-5";
    expect(getPbeXMinIntervalHours()).toBe(6);
    process.env.PBE_X_MIN_INTERVAL_HOURS = "not-a-number";
    expect(getPbeXMinIntervalHours()).toBe(6);
  });
});

describe("isPbeXRateLimited（純関数）", () => {
  it("lastFetchAtがnull（初回）ならレート制限しない", () => {
    expect(isPbeXRateLimited(new Date("2026-07-29T12:00:00.000Z"), null, 6)).toBe(false);
  });

  it("前回取得からminIntervalHours未満ならレート制限中(true)", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const last = new Date("2026-07-29T08:00:00.000Z"); // 4時間前
    expect(isPbeXRateLimited(now, last, 6)).toBe(true);
  });

  it("前回取得からminIntervalHours以上経過していればレート制限しない(false)", () => {
    const now = new Date("2026-07-29T14:00:00.000Z");
    const last = new Date("2026-07-29T08:00:00.000Z"); // 6時間前ちょうど
    expect(isPbeXRateLimited(now, last, 6)).toBe(false);
    const overLast = new Date("2026-07-29T07:00:00.000Z"); // 7時間前
    expect(isPbeXRateLimited(now, overLast, 6)).toBe(false);
  });
});

describe("readLastPbeXFetchAt / writeLastPbeXFetchAt（ファイルI/O、信頼境界）", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("書き込んだ時刻をそのまま読み戻せる（往復）", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-x-rate-limit-test-"));
    const filePath = path.join(dir, "state.json");
    const at = new Date("2026-07-29T09:30:00.000Z");

    writeLastPbeXFetchAt(at, filePath);
    const read = readLastPbeXFetchAt(filePath);

    expect(read).toEqual(at);
  });

  it("ファイルが存在しない場合はnullを返す（例外を投げない・初回扱い）", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-x-rate-limit-test-"));
    const missingPath = path.join(dir, "does-not-exist.json");
    expect(readLastPbeXFetchAt(missingPath)).toBeNull();
  });

  it("壊れたJSONでも例外を投げずnullを返す", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-x-rate-limit-test-"));
    const filePath = path.join(dir, "broken.json");
    // 直接壊れた内容を書き込む（writeLastPbeXFetchAt経由ではない）。
    writeFileSync(filePath, "{not valid json", "utf-8");
    expect(readLastPbeXFetchAt(filePath)).toBeNull();
  });

  it("親ディレクトリが存在しなくても書き込み時に自動作成する", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pbe-x-rate-limit-test-"));
    const nestedPath = path.join(dir, "nested", "deeper", "state.json");
    const at = new Date("2026-07-29T10:00:00.000Z");
    expect(() => writeLastPbeXFetchAt(at, nestedPath)).not.toThrow();
    expect(readLastPbeXFetchAt(nestedPath)).toEqual(at);
  });

  it("書き込み権限が無い等の失敗時も例外を投げない（存在しないドライブレターへの書き込みを模擬）", () => {
    // Windows/POSIXいずれでも書き込み不能な明らかに無効なパスを使う。
    const invalidPath =
      process.platform === "win32" ? "Z:\\definitely-not-a-real-drive\\state.json" : "/proc/1/root/state.json";
    expect(() => writeLastPbeXFetchAt(new Date(), invalidPath)).not.toThrow();
  });
});
