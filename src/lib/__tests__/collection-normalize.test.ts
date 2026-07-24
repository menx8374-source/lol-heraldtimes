import { describe, expect, it } from "vitest";
import { normalizeUrl } from "@/lib/collection/normalize";

describe("normalizeUrl", () => {
  it("ホスト名を小文字化する", () => {
    expect(normalizeUrl("https://WWW.Reddit.com/r/leagueoflegends/")).toBe("https://www.reddit.com/r/leagueoflegends");
  });

  it("末尾スラッシュを除去する(ルートパスは除く)", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("トラッキングクエリパラメータ(utm_*, ref, fbclid等)を除去する", () => {
    const url = "https://example.com/news/article?utm_source=twitter&utm_medium=social&ref=share&id=42";
    expect(normalizeUrl(url)).toBe("https://example.com/news/article?id=42");
  });

  it("ハッシュフラグメントを除去する", () => {
    expect(normalizeUrl("https://example.com/page#section2")).toBe("https://example.com/page");
  });

  it("クエリパラメータの順序が異なっても同じ正規化結果になる", () => {
    const a = normalizeUrl("https://example.com/page?b=2&a=1");
    const b = normalizeUrl("https://example.com/page?a=1&b=2");
    expect(a).toBe(b);
  });

  it("同一URLの表記ゆれ(大文字/末尾スラッシュ/トラッキングパラメータ)が同じキーに畳み込まれる", () => {
    const a = normalizeUrl("https://www.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes/");
    const b = normalizeUrl("https://WWW.leagueoflegends.com/ja-jp/news/game-updates/patch-14-6-notes?utm_source=x");
    expect(a).toBe(b);
  });

  it("パース不能な文字列は前後空白除去・小文字化して返す(例外を投げない)", () => {
    expect(normalizeUrl("  NOT A URL  ")).toBe("not a url");
  });
});
