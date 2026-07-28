import { describe, expect, it } from "vitest";
import { TRANSLATION_GLOSSARY, buildTranslationGlossaryText } from "@/lib/generation/translation-glossary";

/**
 * 成長G4 F-G4-2: 翻訳用スラング対訳表のテスト（brief テスト1）。
 */
describe("TRANSLATION_GLOSSARY / buildTranslationGlossaryText（成長G4 F-G4-2）", () => {
  it("対訳データにenキーの重複が無い", () => {
    const enKeys = TRANSLATION_GLOSSARY.map((e) => e.en);
    expect(new Set(enKeys).size).toBe(enKeys.length);
  });

  it("主要なLoLスラング(inting/diff/hard stuck等)を含む", () => {
    const text = buildTranslationGlossaryText();
    expect(text).toContain("inting");
    expect(text).toContain("diff");
    expect(text).toContain("hard stuck");
    expect(text).toContain("gg");
    expect(text).toContain("nerf");
  });

  it("決定論的(同じ入力で常に同じテキストを返す)", () => {
    expect(buildTranslationGlossaryText()).toBe(buildTranslationGlossaryText());
  });

  it("各エントリのjaが非空文字列", () => {
    for (const entry of TRANSLATION_GLOSSARY) {
      expect(entry.ja.trim().length).toBeGreaterThan(0);
      expect(entry.en.trim().length).toBeGreaterThan(0);
    }
  });
});
