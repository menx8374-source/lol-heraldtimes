import { describe, expect, it } from "vitest";
import {
  CATEGORY_LABELS,
  categoryLabelForSlug,
  categorySlugFor,
  isReactionCategory,
} from "@/lib/categories";

describe("カテゴリ整理（拡張E19 F-E19-1/2、拡張E45で「eスポーツ」を削除→リファクタリングS7aで再追加、成長G7で「Xの反応」追加）", () => {
  it("「公式ニュース」「動画・クリップ」は廃止されたまま、Riot公式・eスポーツ・Xの反応を含む6カテゴリになる", () => {
    expect(CATEGORY_LABELS).not.toContain("公式ニュース");
    expect(CATEGORY_LABELS).not.toContain("動画・クリップ");
    expect(CATEGORY_LABELS.sort()).toEqual(
      ["パッチ/メタ", "Riot公式", "eスポーツ", "5chの反応", "海外の反応", "Xの反応"].sort(),
    );
  });

  it("既存カテゴリ（パッチ/メタ・5chの反応・海外の反応）のスラッグは不変", () => {
    expect(categorySlugFor("パッチ/メタ")).toBe("patch-meta");
    expect(categorySlugFor("5chの反応")).toBe("5ch");
    expect(categorySlugFor("海外の反応")).toBe("overseas");
  });

  it("新設カテゴリ（Riot公式・eスポーツ・Xの反応）のスラッグが定義される", () => {
    expect(categorySlugFor("Riot公式")).toBe("riot-official");
    expect(categorySlugFor("eスポーツ")).toBe("esports");
    expect(categorySlugFor("Xの反応")).toBe("x");
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

describe("isReactionCategory（拡張E38 テスト2）", () => {
  it("「5chの反応」「海外の反応」はtrue", () => {
    expect(isReactionCategory("5chの反応")).toBe(true);
    expect(isReactionCategory("海外の反応")).toBe(true);
  });

  it("「パッチ/メタ」「Riot公式」「eスポーツ」「Xの反応」「未知」はfalse（反応カテゴリではない）", () => {
    expect(isReactionCategory("パッチ/メタ")).toBe(false);
    expect(isReactionCategory("Riot公式")).toBe(false);
    expect(isReactionCategory("eスポーツ")).toBe(false);
    // 「Xの反応」は独自見出し・要約が主・埋め込み/引用が従の構成(composeXBody)のため、
    // 5ch/reddit反応記事のチャンピオンスプラッシュ・フォールバック対象には含めない。
    expect(isReactionCategory("Xの反応")).toBe(false);
    expect(isReactionCategory("未知のカテゴリ")).toBe(false);
  });

  it("null/undefinedはfalse", () => {
    expect(isReactionCategory(null)).toBe(false);
    expect(isReactionCategory(undefined)).toBe(false);
  });
});
