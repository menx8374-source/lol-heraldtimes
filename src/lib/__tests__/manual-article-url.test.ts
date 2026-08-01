/**
 * admincms-S2 F5/F6: URL判定・正規化の純関数テスト。
 * 対応/非対応ホスト・クエリ付き/末尾スラッシュ有無/大文字小文字違いでの同一化・
 * 非URL文字列/危険スキームの拒否を検証する。
 */
import { describe, expect, it } from "vitest";
import { parseManualArticleUrl } from "@/lib/admin/manual-article-url";

describe("parseManualArticleUrl（純関数）", () => {
  it("Redditスレッド URL（www.reddit.com）を source=reddit・externalId抽出できる", () => {
    const result = parseManualArticleUrl(
      "https://www.reddit.com/r/leagueoflegends/comments/abc123/some_title/",
    );
    expect(result).toEqual({
      source: "reddit",
      externalId: "abc123",
      normalizedUrl: "https://www.reddit.com/comments/abc123",
    });
  });

  it("old.reddit.com・末尾スラッシュ無しでも同じexternalIdに正規化される", () => {
    const result = parseManualArticleUrl(
      "https://old.reddit.com/r/leagueoflegends/comments/abc123/some_title",
    );
    expect(result).toEqual({
      source: "reddit",
      externalId: "abc123",
      normalizedUrl: "https://www.reddit.com/comments/abc123",
    });
  });

  it("reddit.com（wwwなし）＋トラッキングクエリ付きでも同一のexternalId/normalizedUrlになる", () => {
    const result = parseManualArticleUrl(
      "https://reddit.com/r/leagueoflegends/comments/abc123/some_title/?utm_source=share&utm_medium=web",
    );
    expect(result).toEqual({
      source: "reddit",
      externalId: "abc123",
      normalizedUrl: "https://www.reddit.com/comments/abc123",
    });
  });

  it("x.com投稿URLを source=x・externalId抽出できる", () => {
    const result = parseManualArticleUrl("https://x.com/some_user/status/1234567890");
    expect(result).toEqual({
      source: "x",
      externalId: "1234567890",
      normalizedUrl: "https://x.com/i/status/1234567890",
    });
  });

  it("twitter.com＋クエリ付き(?s=20)でも同一のexternalId/normalizedUrlになる", () => {
    const result = parseManualArticleUrl("https://twitter.com/some_user/status/1234567890?s=20");
    expect(result).toEqual({
      source: "x",
      externalId: "1234567890",
      normalizedUrl: "https://x.com/i/status/1234567890",
    });
  });

  it("ホスト大文字小文字違い（X.COM）でも同一に判定される", () => {
    const result = parseManualArticleUrl("https://X.COM/some_user/status/1234567890");
    expect(result).toEqual({
      source: "x",
      externalId: "1234567890",
      normalizedUrl: "https://x.com/i/status/1234567890",
    });
  });

  it("mobile.twitter.com / www.x.com も対応ホストとして扱われる", () => {
    expect(parseManualArticleUrl("https://mobile.twitter.com/u/status/42")).toMatchObject({ source: "x", externalId: "42" });
    expect(parseManualArticleUrl("https://www.x.com/u/status/42")).toMatchObject({ source: "x", externalId: "42" });
  });

  it("非対応ホストは unsupported", () => {
    expect(parseManualArticleUrl("https://example.com/foo")).toEqual({ error: "unsupported" });
  });

  it("対応ホストでもパスがcomments/status形式でなければ unsupported", () => {
    expect(parseManualArticleUrl("https://www.reddit.com/r/leagueoflegends/")).toEqual({ error: "unsupported" });
    expect(parseManualArticleUrl("https://x.com/some_user")).toEqual({ error: "unsupported" });
  });

  it("空文字は invalid", () => {
    expect(parseManualArticleUrl("")).toEqual({ error: "invalid" });
    expect(parseManualArticleUrl("   ")).toEqual({ error: "invalid" });
  });

  it("URLでない文字列は invalid", () => {
    expect(parseManualArticleUrl("abc")).toEqual({ error: "invalid" });
  });

  it("javascript: 等の非http(s)スキームは invalid", () => {
    expect(parseManualArticleUrl("javascript:alert(1)")).toEqual({ error: "invalid" });
    expect(parseManualArticleUrl("ftp://reddit.com/comments/abc123")).toEqual({ error: "invalid" });
  });
});
