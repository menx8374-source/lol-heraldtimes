import { describe, expect, it } from "vitest";
import {
  isTrackingAllowed,
  parseConsentStatus,
  shouldShowConsentBanner,
} from "@/lib/consent";

describe("parseConsentStatus", () => {
  it("'accepted'はそのままacceptedにする", () => {
    expect(parseConsentStatus("accepted")).toBe("accepted");
  });

  it("'rejected'はそのままrejectedにする", () => {
    expect(parseConsentStatus("rejected")).toBe("rejected");
  });

  it("未設定・不正な値はunknownにフォールバックする", () => {
    expect(parseConsentStatus(null)).toBe("unknown");
    expect(parseConsentStatus(undefined)).toBe("unknown");
    expect(parseConsentStatus("")).toBe("unknown");
    expect(parseConsentStatus("yes")).toBe("unknown");
  });
});

describe("shouldShowConsentBanner", () => {
  it("unknownのときのみバナーを表示する", () => {
    expect(shouldShowConsentBanner("unknown")).toBe(true);
    expect(shouldShowConsentBanner("accepted")).toBe(false);
    expect(shouldShowConsentBanner("rejected")).toBe(false);
  });
});

describe("isTrackingAllowed（同意前トラッキング禁止の判定）", () => {
  it("acceptedのときのみトラッキングを許可する", () => {
    expect(isTrackingAllowed("accepted")).toBe(true);
  });

  it("rejected・unknownはトラッキングを許可しない", () => {
    expect(isTrackingAllowed("rejected")).toBe(false);
    expect(isTrackingAllowed("unknown")).toBe(false);
  });
});
