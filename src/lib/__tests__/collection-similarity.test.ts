import { describe, expect, it } from "vitest";
import { isSameTopic, jaccardSimilarity } from "@/lib/collection/similarity";

describe("jaccardSimilarity", () => {
  it("完全に同じ文字列は類似度1", () => {
    expect(jaccardSimilarity("パッチ14.6ノート公開", "パッチ14.6ノート公開")).toBe(1);
  });

  it("全く異なる文字列は類似度が低い", () => {
    expect(jaccardSimilarity("パッチ14.6ノート公開", "ヤスオの伝説的プレイ")).toBeLessThan(0.2);
  });

  it("片方が空文字の場合は類似度0", () => {
    expect(jaccardSimilarity("何か文章", "")).toBe(0);
  });

  it("両方空文字の場合は類似度1(空同士は一致とみなす)", () => {
    expect(jaccardSimilarity("", "")).toBe(1);
  });
});

describe("isSameTopic", () => {
  it("ほぼ同一の英文タイトル・本文(語順違い程度)は同一話題と判定する", () => {
    const a = {
      title: "Patch 14.6 Jungle Nerf Discussion Thread",
      content:
        "Riot pushed a big jungle XP nerf in patch 14.6. Community reactions are mixed, with jungle mains worried about their power spikes being delayed.",
    };
    const b = {
      title: "Patch 14.6 Jungle Nerf Megathread",
      content:
        "Riot pushed a big jungle XP nerf in patch 14.6, and many jungle mains are worried their power spikes will now come later than before.",
    };
    expect(isSameTopic(a, b)).toBe(true);
  });

  it("全く無関係なタイトル・本文は同一話題と判定しない", () => {
    const a = { title: "Patch 14.6 Jungle Nerf Discussion Thread", content: "Jungle XP nerf discussion." };
    const b = { title: "Yasuo OTP pulls off an insane outplay", content: "Amazing wall-jump combo clip." };
    expect(isSameTopic(a, b)).toBe(false);
  });

  it("しきい値を明示的に指定できる", () => {
    const a = { title: "AAAA", content: "BBBB" };
    const b = { title: "AAAA", content: "CCCC" };
    // タイトル完全一致・本文完全不一致 → combined = 1*0.7 + 0*0.3 = 0.7
    expect(isSameTopic(a, b, 0.6)).toBe(true);
    expect(isSameTopic(a, b, 0.8)).toBe(false);
  });
});
