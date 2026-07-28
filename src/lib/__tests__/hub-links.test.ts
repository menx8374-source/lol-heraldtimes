import { describe, expect, it } from "vitest";
import {
  buildCategoryHubLink,
  buildHubLinks,
  buildTagHubLink,
  isForbiddenAnchorText,
} from "@/lib/hub-links";

describe("isForbiddenAnchorText", () => {
  it("「こちら」「詳しくは」「リンク」単体を禁止語として検出する", () => {
    expect(isForbiddenAnchorText("こちら")).toBe(true);
    expect(isForbiddenAnchorText("詳しくはこちら")).toBe(true);
    expect(isForbiddenAnchorText("リンク")).toBe(true);
    expect(isForbiddenAnchorText(" リンク ")).toBe(true);
  });

  it("キーワードを含む正常なアンカーは禁止語と判定しない", () => {
    expect(isForbiddenAnchorText("ヨネのまとめをもっと見る")).toBe(false);
    expect(isForbiddenAnchorText("パッチ/メタの記事一覧")).toBe(false);
    expect(isForbiddenAnchorText("外部リンク一覧")).toBe(false);
  });
});

describe("buildCategoryHubLink / buildTagHubLink", () => {
  it("カテゴリ名を含むアンカーテキストと /category/<slug> のリンクを作る", () => {
    const link = buildCategoryHubLink("パッチ/メタ", "patch-meta");
    expect(link.href).toBe("/category/patch-meta");
    expect(link.label).toContain("パッチ/メタ");
    expect(isForbiddenAnchorText(link.label)).toBe(false);
  });

  it("タグ名を含むアンカーテキストと /tags/<tag> のリンクを作る", () => {
    const link = buildTagHubLink("ヨネ");
    expect(link.href).toBe("/tags/ヨネ");
    expect(link.label).toContain("ヨネ");
    expect(isForbiddenAnchorText(link.label)).toBe(false);
  });
});

describe("buildHubLinks", () => {
  it("カテゴリ→タグの順でハブリンクを組み立てる", () => {
    const links = buildHubLinks({ category: "海外の反応", categorySlug: "overseas", tags: ["ヨネ", "ジャングル"] });

    expect(links.map((l) => l.href)).toEqual(["/category/overseas", "/tags/ヨネ", "/tags/ジャングル"]);
    for (const link of links) {
      expect(isForbiddenAnchorText(link.label)).toBe(false);
    }
  });

  it("categorySlug が未定義の場合はカテゴリリンクを省略する", () => {
    const links = buildHubLinks({ category: "不明カテゴリ", categorySlug: undefined, tags: ["ヨネ"] });

    expect(links.map((l) => l.href)).toEqual(["/tags/ヨネ"]);
  });

  it("タグが無い場合はタグリンクを含めない", () => {
    const links = buildHubLinks({ category: "Riot公式", categorySlug: "riot-official", tags: [] });

    expect(links).toEqual([{ href: "/category/riot-official", label: "Riot公式の記事一覧" }]);
  });
});
