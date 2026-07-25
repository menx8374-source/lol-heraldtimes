import { describe, expect, it } from "vitest";
import { isAnchorAdDismissed, shouldShowAnchorAd } from "@/lib/ads/anchor";

describe("isAnchorAdDismissed", () => {
  it("保存値が'1'なら閉じた状態と判定する", () => {
    expect(isAnchorAdDismissed("1")).toBe(true);
  });

  it("未設定(null)・空文字・その他の値は閉じていないと判定する", () => {
    expect(isAnchorAdDismissed(null)).toBe(false);
    expect(isAnchorAdDismissed(undefined)).toBe(false);
    expect(isAnchorAdDismissed("")).toBe(false);
    expect(isAnchorAdDismissed("0")).toBe(false);
    expect(isAnchorAdDismissed("true")).toBe(false);
  });
});

describe("shouldShowAnchorAd", () => {
  it("閉じていなければ表示する", () => {
    expect(shouldShowAnchorAd(null)).toBe(true);
  });

  it("閉じていれば表示しない", () => {
    expect(shouldShowAnchorAd("1")).toBe(false);
  });
});
