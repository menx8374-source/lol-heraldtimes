import { describe, expect, it } from "vitest";
import { GLOSSARY_TERMS, getGlossaryTermBySlug, listGlossaryTerms } from "@/lib/lol-data/glossary";

describe("GLOSSARY_TERMS データ整合性", () => {
  it("スラッグ・用語名がそれぞれ一意である", () => {
    const slugs = GLOSSARY_TERMS.map((t) => t.slug);
    const terms = GLOSSARY_TERMS.map((t) => t.term);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("すべてASCII安全なスラッグを持つ", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(t.slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("定義文が空でない", () => {
    for (const t of GLOSSARY_TERMS) {
      expect(t.definition.length).toBeGreaterThan(0);
    }
  });
});

describe("listGlossaryTerms", () => {
  it("query未指定は五十音(かな)順の全件を返す", () => {
    const list = listGlossaryTerms();
    expect(list).toHaveLength(GLOSSARY_TERMS.length);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].kana.localeCompare(list[i].kana, "ja")).toBeLessThanOrEqual(0);
    }
  });

  it("用語名にマッチする絞り込みができる", () => {
    const result = listGlossaryTerms("ガンク");
    expect(result.some((t) => t.term === "ガンク")).toBe(true);
    expect(result.every((t) => t.term.includes("ガンク") || t.definition.includes("ガンク"))).toBe(true);
  });

  it("定義文にのみマッチする語句でも絞り込める", () => {
    const result = listGlossaryTerms("ゴールド");
    expect(result.length).toBeGreaterThan(0);
  });

  it("該当なしの場合は空配列を返す", () => {
    expect(listGlossaryTerms("存在しない用語XYZ")).toEqual([]);
  });
});

describe("getGlossaryTermBySlug", () => {
  it("存在するスラッグは用語を返す", () => {
    expect(getGlossaryTermBySlug("gank")?.term).toBe("ガンク");
  });

  it("存在しないスラッグは undefined を返す", () => {
    expect(getGlossaryTermBySlug("no-such-term")).toBeUndefined();
  });
});
