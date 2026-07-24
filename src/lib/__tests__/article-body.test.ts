import { describe, expect, it } from "vitest";
import {
  hasStructuredHeadings,
  parseArticleBody,
  InvalidArticleBodyError,
} from "@/lib/article-body";

describe("parseArticleBody", () => {
  it("見出し・段落・引用が混在する正しい構造をパースできる", () => {
    const input = [
      { type: "heading", text: "導入" },
      { type: "paragraph", text: "海外のフォーラムでは大きな話題になっている。" },
      { type: "quote", text: "このチャンピオンは強すぎる", source: "Reddit" },
    ];

    const result = parseArticleBody(input);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "heading", text: "導入" });
    expect(result[2]).toMatchObject({ type: "quote", source: "Reddit" });
  });

  it("配列でない値は不正としてエラーを投げる（長文ベタ書き対策）", () => {
    expect(() => parseArticleBody("ただの長い文字列です")).toThrow(
      InvalidArticleBodyError,
    );
  });

  it("空配列はエラーを投げる", () => {
    expect(() => parseArticleBody([])).toThrow(InvalidArticleBodyError);
  });

  it("未知の type はエラーを投げる", () => {
    expect(() => parseArticleBody([{ type: "video", text: "x" }])).toThrow(
      InvalidArticleBodyError,
    );
  });

  it("text が空文字のブロックはエラーを投げる", () => {
    expect(() => parseArticleBody([{ type: "paragraph", text: "" }])).toThrow(
      InvalidArticleBodyError,
    );
  });
});

describe("hasStructuredHeadings", () => {
  it("heading ブロックが1件以上あれば true", () => {
    const blocks = parseArticleBody([
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "本文" },
    ]);
    expect(hasStructuredHeadings(blocks)).toBe(true);
  });

  it("heading が無ければ false", () => {
    const blocks = parseArticleBody([{ type: "paragraph", text: "本文だけ" }]);
    expect(hasStructuredHeadings(blocks)).toBe(false);
  });
});
