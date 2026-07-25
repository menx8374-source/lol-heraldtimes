import { describe, expect, it } from "vitest";
import { decideInitialDesign, DESIGN_STORAGE_KEY, DESIGN_CLASS } from "@/lib/design-mode";

describe("decideInitialDesign（拡張E14: デザイン軸の初期値決定）", () => {
  it("未保存（null）は既定の classic", () => {
    expect(decideInitialDesign(null)).toBe("classic");
  });

  it("保存値が news なら news", () => {
    expect(decideInitialDesign("news")).toBe("news");
  });

  it("保存値が classic なら classic", () => {
    expect(decideInitialDesign("classic")).toBe("classic");
  });

  it("不正な保存値（想定外の文字列・空文字）は classic にフォールバックする", () => {
    expect(decideInitialDesign("dark")).toBe("classic");
    expect(decideInitialDesign("")).toBe("classic");
    expect(decideInitialDesign("NEWS")).toBe("classic");
  });
});

describe("定数（キー名・クラス名。DesignToggle/no-flashスクリプトと共有）", () => {
  it("localStorageキーとhtmlクラス名が期待どおり", () => {
    expect(DESIGN_STORAGE_KEY).toBe("lol-matome:design");
    expect(DESIGN_CLASS).toBe("design-news");
  });
});
