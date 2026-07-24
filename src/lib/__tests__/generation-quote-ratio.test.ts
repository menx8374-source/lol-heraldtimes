import { describe, expect, it } from "vitest";
import { computeQuoteRatio, hasAcceptableQuoteRatio, DEFAULT_QUOTE_RATIO_THRESHOLD } from "@/lib/generation/quote-ratio";
import type { ArticleBodyBlock } from "@/lib/article-body";

describe("computeQuoteRatio / hasAcceptableQuoteRatio", () => {
  it("引用ブロックが無ければ比率は0で、主従関係を満たす", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "本文がここに入る。".repeat(10) },
    ];
    expect(computeQuoteRatio(blocks)).toBe(0);
    expect(hasAcceptableQuoteRatio(blocks)).toBe(true);
  });

  it("引用が本文の一部（少数）なら主従関係を満たす", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "自サイトの生成文がここに長く入る。".repeat(10) },
      { type: "quote", text: "短い引用文。", source: "5chの反応" },
    ];
    expect(computeQuoteRatio(blocks)).toBeLessThan(DEFAULT_QUOTE_RATIO_THRESHOLD);
    expect(hasAcceptableQuoteRatio(blocks)).toBe(true);
  });

  it("引用が本文の大半を占める場合は主従関係を満たさない", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "短い導入。" },
      { type: "quote", text: "非常に長い引用文。".repeat(20), source: "5chの反応" },
    ];
    expect(computeQuoteRatio(blocks)).toBeGreaterThan(DEFAULT_QUOTE_RATIO_THRESHOLD);
    expect(hasAcceptableQuoteRatio(blocks)).toBe(false);
  });

  it("全ブロックの合計文字数が0なら比率は0", () => {
    expect(computeQuoteRatio([])).toBe(0);
  });
});
