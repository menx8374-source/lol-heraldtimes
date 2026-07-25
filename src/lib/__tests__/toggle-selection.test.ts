/**
 * 「1記事1リアクション」「1コメント1票」の状態遷移（拡張E13）の純関数テスト。
 */
import { describe, expect, it } from "vitest";
import { computeToggle } from "@/lib/toggle-selection";

describe("computeToggle（拡張E13: 1ユーザー1選択の状態遷移）", () => {
  it("未選択の対象を押すと選択され、addリクエストが1件生成される", () => {
    const result = computeToggle<string>(null, "👍");
    expect(result).toEqual({ selection: "👍", requests: [{ value: "👍", op: "add" }] });
  });

  it("選択中の対象を再度押すと選択解除され、removeリクエストが1件生成される（トグル）", () => {
    const result = computeToggle("👍", "👍");
    expect(result).toEqual({ selection: null, requests: [{ value: "👍", op: "remove" }] });
  });

  it("別の対象を押すと前の選択がremove・新しい選択がaddの2件になる（切替）", () => {
    const result = computeToggle("👍", "😂");
    expect(result).toEqual({
      selection: "😂",
      requests: [
        { value: "👍", op: "remove" },
        { value: "😂", op: "add" },
      ],
    });
  });

  it("good/badのような2値の投票でも同様に動作する", () => {
    expect(computeToggle<"good" | "bad">(null, "good")).toEqual({
      selection: "good",
      requests: [{ value: "good", op: "add" }],
    });
    expect(computeToggle<"good" | "bad">("good", "bad")).toEqual({
      selection: "bad",
      requests: [
        { value: "good", op: "remove" },
        { value: "bad", op: "add" },
      ],
    });
    expect(computeToggle<"good" | "bad">("bad", "bad")).toEqual({
      selection: null,
      requests: [{ value: "bad", op: "remove" }],
    });
  });
});
