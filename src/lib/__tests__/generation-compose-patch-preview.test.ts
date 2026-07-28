import { afterEach, describe, expect, it } from "vitest";
import { composeArticleBody, isPatchPreviewArticleBody } from "@/lib/generation/compose";
import { MockLLMClient } from "@/lib/generation/llm-client";

/**
 * 未適用パッチの速報バッジ（パッチ記事刷新S5 F-S5-2）のテスト。
 * `PATCH_ARTICLE_MODE=fact`（LLM非依存・決定論）で本体部分を固定し、
 * `candidate.isPatchPreview` の有無による差分だけを検証する。
 */
const llm = new MockLLMClient();
const sourceUrl = "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-15-notes";

describe("composeArticleBody（riot、未適用パッチの速報バッジ、パッチ記事刷新S5 F-S5-2）", () => {
  afterEach(() => {
    delete process.env.PATCH_ARTICLE_MODE;
  });

  it("isPatchPreview未指定/falseでは速報バッジが付かず従来と完全同一(回帰ゼロ)", async () => {
    process.env.PATCH_ARTICLE_MODE = "fact";
    const withoutFlag = await composeArticleBody(
      { sourceType: "riot", title: "【パッチ】26.15 のゲームデータが公開", content: "短い本文", sourceUrl },
      llm,
    );
    const withFalse = await composeArticleBody(
      {
        sourceType: "riot",
        title: "【パッチ】26.15 のゲームデータが公開",
        content: "短い本文",
        sourceUrl,
        isPatchPreview: false,
      },
      llm,
    );
    expect(isPatchPreviewArticleBody(withoutFlag)).toBe(false);
    expect(isPatchPreviewArticleBody(withFalse)).toBe(false);
    expect(withoutFlag).toEqual(withFalse);
  });

  it("isPatchPreview=trueでは本文先頭に速報バッジ段落が追加され、本体は変わらない(捏造なし)", async () => {
    process.env.PATCH_ARTICLE_MODE = "fact";
    const base = await composeArticleBody(
      { sourceType: "riot", title: "【パッチ】26.15 のゲームデータが公開", content: "短い本文", sourceUrl },
      llm,
    );
    const preview = await composeArticleBody(
      {
        sourceType: "riot",
        title: "【速報】【パッチ】26.15 のゲームデータが公開",
        content: "短い本文",
        sourceUrl,
        isPatchPreview: true,
      },
      llm,
    );

    expect(isPatchPreviewArticleBody(preview)).toBe(true);
    expect(preview[0].type).toBe("paragraph");
    expect((preview[0] as { text: string }).text).toContain("未適用");
    expect((preview[0] as { text: string }).text).toContain("公式パッチノート");
    // バッジを除けば本体（見出し・段落・リンクボタン等）は非preview版と一致する（捏造しない）。
    expect(preview.slice(1)).toEqual(base);
  });

  it("isPatchPreviewArticleBodyは速報バッジが無い本文をfalseと判定する(既存の確定記事は誤判定されない)", () => {
    expect(isPatchPreviewArticleBody([{ type: "heading", text: "パッチ26.15が公開" }])).toBe(false);
    expect(isPatchPreviewArticleBody([{ type: "paragraph", text: "普通の段落" }])).toBe(false);
    expect(isPatchPreviewArticleBody([])).toBe(false);
  });
});
