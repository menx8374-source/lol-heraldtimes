import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  categoryLabelForSlug,
  categorySlugFor,
} from "@/lib/categories";

describe("カテゴリ整理（拡張E19 F-E19-1/2）", () => {
  it("「公式ニュース」「動画・クリップ」は廃止され、4カテゴリのみが残る", () => {
    expect(CATEGORY_LABELS).not.toContain("公式ニュース");
    expect(CATEGORY_LABELS).not.toContain("動画・クリップ");
    expect(CATEGORY_LABELS.sort()).toEqual(
      ["パッチ/メタ", "5chの反応", "海外の反応", "eスポーツ"].sort(),
    );
  });
});

describe("categorySlugFor / categoryLabelForSlug", () => {
  it("全カテゴリラベルにASCII安全なスラッグが定義され、相互変換できる", () => {
    for (const label of CATEGORY_LABELS) {
      const slug = categorySlugFor(label);
      expect(slug).toBeDefined();
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(categoryLabelForSlug(slug!)).toBe(label);
    }
  });

  it("未定義のカテゴリ文字列は undefined を返す", () => {
    expect(categorySlugFor("存在しないカテゴリ")).toBeUndefined();
  });

  it("未知のスラッグは undefined を返す", () => {
    expect(categoryLabelForSlug("unknown-slug")).toBeUndefined();
  });
});
