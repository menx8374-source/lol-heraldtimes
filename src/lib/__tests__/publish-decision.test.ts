/**
 * 公開可否の統合判定（admincms-S1 F3）の純関数テスト。
 * テスト観点: （安全フィルタ不通過, ポリシー自動公開）→held、（通過, 自動公開）→published、
 * （通過, 要レビュー）→review の3分岐を入出力で網羅する（held優先の確認を含む）。
 */
import { describe, expect, it } from "vitest";
import { decidePublishState } from "@/lib/generation/publish-decision";

describe("decidePublishState（安全フィルタ×カテゴリ公開ポリシーの統合判定）", () => {
  it("安全フィルタ不通過・ポリシー自動公開 → held（フィルタ優先）", () => {
    expect(decidePublishState({ moderationHeld: true, autoPublish: true })).toBe("held");
  });

  it("安全フィルタ不通過・ポリシー要レビュー → held", () => {
    expect(decidePublishState({ moderationHeld: true, autoPublish: false })).toBe("held");
  });

  it("安全フィルタ通過・ポリシー自動公開 → published", () => {
    expect(decidePublishState({ moderationHeld: false, autoPublish: true })).toBe("published");
  });

  it("安全フィルタ通過・ポリシー要レビュー → review", () => {
    expect(decidePublishState({ moderationHeld: false, autoPublish: false })).toBe("review");
  });
});
