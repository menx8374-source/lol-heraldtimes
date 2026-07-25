import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AD_SLOT_POSITIONS, getAdSlotCode, type AdSlotPosition } from "@/lib/ads/config";
import { POSITION_LABELS } from "@/components/ad-slot";

const ENV_KEY_BY_POSITION: Record<AdSlotPosition, string> = {
  "article-top": "AD_SLOT_ARTICLE_TOP",
  "article-in-body": "AD_SLOT_ARTICLE_IN_BODY",
  "article-bottom": "AD_SLOT_ARTICLE_BOTTOM",
  sidebar: "AD_SLOT_SIDEBAR",
  listing: "AD_SLOT_LISTING",
  "sidebar-sticky": "AD_SLOT_SIDEBAR_STICKY",
  anchor: "AD_SLOT_ANCHOR",
  "matched-content": "AD_SLOT_MATCHED_CONTENT",
};

describe("AdSlotPosition の一貫性（拡張E5で追加した種類を含む）", () => {
  it("全positionに対応するENV_KEYが存在する", () => {
    for (const position of AD_SLOT_POSITIONS) {
      expect(ENV_KEY_BY_POSITION[position]).toBeDefined();
    }
  });

  it("全positionに対応するPOSITION_LABELSが存在し、空文字でない", () => {
    for (const position of AD_SLOT_POSITIONS) {
      expect(POSITION_LABELS[position]).toBeTruthy();
    }
  });

  it("拡張E5で追加した新種の広告枠を含む", () => {
    expect(AD_SLOT_POSITIONS).toContain("sidebar-sticky");
    expect(AD_SLOT_POSITIONS).toContain("anchor");
    expect(AD_SLOT_POSITIONS).toContain("matched-content");
  });
});

describe("getAdSlotCode（新種の広告枠）", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AD_SLOT_SIDEBAR_STICKY;
    delete process.env.AD_SLOT_ANCHOR;
    delete process.env.AD_SLOT_MATCHED_CONTENT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("未設定時はundefinedを返す", () => {
    expect(getAdSlotCode("sidebar-sticky")).toBeUndefined();
    expect(getAdSlotCode("anchor")).toBeUndefined();
    expect(getAdSlotCode("matched-content")).toBeUndefined();
  });

  it("空白のみの値もundefinedとして扱う", () => {
    process.env.AD_SLOT_ANCHOR = "   ";
    expect(getAdSlotCode("anchor")).toBeUndefined();
  });

  it("設定済みの値をtrimして返す", () => {
    process.env.AD_SLOT_MATCHED_CONTENT = "  <div>ad</div>  ";
    expect(getAdSlotCode("matched-content")).toBe("<div>ad</div>");
  });
});
