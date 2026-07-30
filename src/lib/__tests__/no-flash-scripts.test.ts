import { describe, expect, it } from "vitest";
import { NO_FLASH_DESIGN_SCRIPT } from "@/lib/no-flash-scripts";
import { DESIGN_STORAGE_KEY, DESIGN_NEWS_CLASS, DESIGN_HEXTECH_CLASS } from "@/lib/design-mode";

describe("NO_FLASH_DESIGN_SCRIPT（拡張E14/E45: 描画前ちらつき防止スクリプト）", () => {
  it("design-mode.ts と同じlocalStorageキー名を参照する", () => {
    expect(NO_FLASH_DESIGN_SCRIPT).toContain(`localStorage.getItem('${DESIGN_STORAGE_KEY}')`);
  });

  it("news選択時に design-mode.ts と同じクラス名を <html> に付与する", () => {
    expect(NO_FLASH_DESIGN_SCRIPT).toContain(`d==='news'`);
    expect(NO_FLASH_DESIGN_SCRIPT).toContain(`classList.add('${DESIGN_NEWS_CLASS}')`);
  });

  it("hextech選択時に design-hextech を <html> に付与する", () => {
    expect(NO_FLASH_DESIGN_SCRIPT).toContain(`d==='hextech'`);
    expect(NO_FLASH_DESIGN_SCRIPT).toContain(`classList.add('${DESIGN_HEXTECH_CLASS}')`);
  });

  it("try/catchで囲まれ、localStorage不可時にも例外を投げない構造になっている（固定の静的スクリプト）", () => {
    expect(NO_FLASH_DESIGN_SCRIPT).toMatch(/^\(function\(\)\{try\{/);
    expect(NO_FLASH_DESIGN_SCRIPT).toContain("catch(e){}");
  });
});
