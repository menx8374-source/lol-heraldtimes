import { describe, expect, it } from "vitest";
import { decodeTagParam } from "@/lib/tags";

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
