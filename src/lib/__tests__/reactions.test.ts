import { describe, expect, it } from "vitest";
import { REACTION_EMOJIS, isValidReactionEmoji, mergeReactionCounts } from "@/lib/reactions";

describe("isValidReactionEmoji", () => {
  it("既定の絵文字は true", () => {
    for (const emoji of REACTION_EMOJIS) {
      expect(isValidReactionEmoji(emoji)).toBe(true);
    }
  });

  it("既定外の文字列は false", () => {
    expect(isValidReactionEmoji("🍣")).toBe(false);
    expect(isValidReactionEmoji("")).toBe(false);
  });
});

describe("mergeReactionCounts", () => {
  it("未登録の絵文字は0件で補う", () => {
    const result = mergeReactionCounts([]);
    for (const emoji of REACTION_EMOJIS) {
      expect(result[emoji]).toBe(0);
    }
  });

  it("DB行のcountを対応する絵文字に反映する", () => {
    const result = mergeReactionCounts([
      { emoji: "👍", count: 5 },
      { emoji: "😂", count: 2 },
    ]);
    expect(result["👍"]).toBe(5);
    expect(result["😂"]).toBe(2);
    expect(result["😮"]).toBe(0);
  });

  it("既定外の絵文字（不正データ）は無視する", () => {
    const result = mergeReactionCounts([{ emoji: "🍣", count: 99 }]);
    expect(Object.values(result).every((c) => c === 0)).toBe(true);
  });
});
