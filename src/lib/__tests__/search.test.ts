import { describe, expect, it } from "vitest";
import { bodyBlocksToText, matchesQuery } from "@/lib/search";
import type { ArticleBodyBlock } from "@/lib/article-body";

describe("bodyBlocksToText", () => {
  it("見出し・段落・引用の text を連結する", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "本文だよ" },
      { type: "quote", text: "引用だよ", source: "Reddit" },
    ];
    expect(bodyBlocksToText(blocks)).toBe("見出し 本文だよ 引用だよ");
  });
});

describe("matchesQuery", () => {
  it("タイトルに含まれるキーワードでヒットする", () => {
    expect(matchesQuery("ヤスオOTPの伝説的プレイ", "本文", "ヤスオ")).toBe(true);
  });

  it("本文に含まれるキーワードでヒットする（タイトルには含まれない）", () => {
    expect(matchesQuery("パッチ14.6の変更点", "ジャングル弱体化が話題", "ジャングル")).toBe(true);
  });

  it("日本語カタカナ語（チャンピオン名）でヒットする", () => {
    expect(matchesQuery("最新Tierリスト解説", "本文", "Tierリスト")).toBe(true);
  });

  it("一致しない場合は false", () => {
    expect(matchesQuery("タイトル", "本文", "ゼド")).toBe(false);
  });

  it("英字の大文字小文字を無視して一致する", () => {
    expect(matchesQuery("ADC build guide", "本文", "adc")).toBe(true);
  });

  it("空白のみのクエリは false（未検索と区別するため呼び出し側でも空扱いにする）", () => {
    expect(matchesQuery("タイトル", "本文", "   ")).toBe(false);
  });
});
