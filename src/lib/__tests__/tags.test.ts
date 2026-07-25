import { describe, expect, it } from "vitest";
import { decodeTagParam, rankTags, tagCloudSizeClass } from "@/lib/tags";

describe("decodeTagParam", () => {
  it("日本語タグ名がブラウザ／Linkによってエンコードされた形をデコードして元のタグ名に戻す", () => {
    const tagName = "ヤスオ";
    // <Link href={`/tags/${tagName}`}> をクリックした際に実際に送信される値を模す。
    const encoded = encodeURIComponent(tagName);
    expect(encoded).toBe("%E3%83%A4%E3%82%B9%E3%82%AA");
    expect(decodeTagParam(encoded)).toBe(tagName);
  });

  it("すでに非エンコードのASCIIタグ名はそのまま返す", () => {
    expect(decodeTagParam("Yasuo")).toBe("Yasuo");
  });

  it("不正なパーセントエンコード列は例外を投げず、受け取った生の文字列にフォールバックする", () => {
    const malformed = "%E3%82"; // 途中で途切れた不正なシーケンス
    expect(() => decodeTagParam(malformed)).not.toThrow();
    expect(decodeTagParam(malformed)).toBe(malformed);
  });
});

describe("rankTags（人気タグ集計, 拡張E4）", () => {
  it("記事数の多い順に並べ、0件タグは除外し、上限件数に絞る", () => {
    const rows = [
      { name: "ヤスオ", count: 3 },
      { name: "アリ", count: 0 },
      { name: "ジンクス", count: 5 },
      { name: "ゼド", count: 1 },
    ];
    expect(rankTags(rows, 2)).toEqual([
      { name: "ジンクス", count: 5 },
      { name: "ヤスオ", count: 3 },
    ]);
  });

  it("件数が同じ場合は名前順で安定する", () => {
    const rows = [
      { name: "ゼド", count: 2 },
      { name: "アリ", count: 2 },
    ];
    expect(rankTags(rows, 5)).toEqual([
      { name: "アリ", count: 2 },
      { name: "ゼド", count: 2 },
    ]);
  });
});

describe("tagCloudSizeClass（タグクラウド文字サイズ, 拡張E4）", () => {
  it("最大件数と同数のタグは最大サイズになる", () => {
    expect(tagCloudSizeClass(10, 10)).toBe("text-xl");
  });

  it("件数が少ないタグは小さいサイズになる", () => {
    expect(tagCloudSizeClass(1, 10)).toBe("text-xs");
  });

  it("maxCountが0以下（タグなし）は最小サイズにフォールバックする", () => {
    expect(tagCloudSizeClass(0, 0)).toBe("text-xs");
  });
});
