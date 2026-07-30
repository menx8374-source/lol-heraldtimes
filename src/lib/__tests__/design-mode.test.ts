import { describe, expect, it } from "vitest";
import {
  decideInitialDesign,
  designClassForMode,
  DESIGN_STORAGE_KEY,
  DESIGN_CLASS,
  DESIGN_NEWS_CLASS,
  DESIGN_HEXTECH_CLASS,
  ALL_DESIGN_CLASSES,
} from "@/lib/design-mode";

describe("decideInitialDesign（拡張E14/E45: デザイン軸の初期値決定）", () => {
  it("未保存（null）は既定の classic", () => {
    expect(decideInitialDesign(null)).toBe("classic");
  });

  it("保存値が news なら news", () => {
    expect(decideInitialDesign("news")).toBe("news");
  });

  it("保存値が hextech なら hextech", () => {
    expect(decideInitialDesign("hextech")).toBe("hextech");
  });

  it("保存値が classic なら classic", () => {
    expect(decideInitialDesign("classic")).toBe("classic");
  });

  it("不正な保存値（想定外の文字列・空文字・大文字違い）は classic にフォールバックする", () => {
    expect(decideInitialDesign("dark")).toBe("classic");
    expect(decideInitialDesign("")).toBe("classic");
    expect(decideInitialDesign("NEWS")).toBe("classic");
    expect(decideInitialDesign("HEXTECH")).toBe("classic");
  });
});

describe("designClassForMode（モード→排他クラス）", () => {
  it("classic はクラス無し（null）", () => {
    expect(designClassForMode("classic")).toBeNull();
  });
  it("news は design-news", () => {
    expect(designClassForMode("news")).toBe(DESIGN_NEWS_CLASS);
  });
  it("hextech は design-hextech", () => {
    expect(designClassForMode("hextech")).toBe(DESIGN_HEXTECH_CLASS);
  });
});

describe("定数（キー名・クラス名。DesignToggle/no-flashスクリプトと共有）", () => {
  it("localStorageキーとhtmlクラス名が期待どおり", () => {
    expect(DESIGN_STORAGE_KEY).toBe("lol-matome:design");
    expect(DESIGN_NEWS_CLASS).toBe("design-news");
    expect(DESIGN_HEXTECH_CLASS).toBe("design-hextech");
    // 後方互換の別名は design-news を指す。
    expect(DESIGN_CLASS).toBe("design-news");
  });

  it("相互排他クラス群は news/hextech の2つ（classicは含まない）", () => {
    expect([...ALL_DESIGN_CLASSES]).toEqual(["design-news", "design-hextech"]);
  });
});
