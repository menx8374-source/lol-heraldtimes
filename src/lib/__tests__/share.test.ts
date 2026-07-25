import { describe, expect, it } from "vitest";
import { buildShareUrl } from "@/lib/share";

const URL = "https://example.com/articles/sample-slug";
const TITLE = "【速報】テスト記事のタイトル&特殊文字?込み";

describe("buildShareUrl", () => {
  it("X(Twitter)は intent/tweet に text・url をエンコードして含める", () => {
    const result = buildShareUrl("x", URL, TITLE);
    expect(result).toBe(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(TITLE)}&url=${encodeURIComponent(URL)}`,
    );
  });

  it("LINEはシェアURLにエンコード済みurlのみ含める", () => {
    const result = buildShareUrl("line", URL, TITLE);
    expect(result).toBe(
      `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(URL)}`,
    );
  });

  it("はてなブックマークはurl・titleの両方をエンコードして含める", () => {
    const result = buildShareUrl("hatena", URL, TITLE);
    expect(result).toBe(
      `https://b.hatena.ne.jp/entry/panel/?url=${encodeURIComponent(URL)}&title=${encodeURIComponent(TITLE)}`,
    );
  });

  it("& や ? を含むタイトル・URLでも壊れず正しくエンコードされる", () => {
    const result = buildShareUrl("x", URL, TITLE);
    expect(result).not.toContain("&特殊文字");
    expect(decodeURIComponent(result.split("text=")[1].split("&url=")[0])).toBe(TITLE);
  });
});
