import { describe, expect, it } from "vitest";
import { computeVerbatimMatchRatio, isVerbatimCopy, DEFAULT_VERBATIM_THRESHOLD } from "@/lib/generation/verbatim";

describe("computeVerbatimMatchRatio / isVerbatimCopy", () => {
  it("生成文が元ソースの完全なコピーなら一致率は1に近く、逐語コピーと判定される", () => {
    const source = "経験値ナーフでジャングラー涙目という意見が多数。序盤のレベル差がつきにくくなったとの声も。";
    const generated = source;
    const ratio = computeVerbatimMatchRatio(generated, source);
    expect(ratio).toBeGreaterThan(DEFAULT_VERBATIM_THRESHOLD);
    expect(isVerbatimCopy(generated, source)).toBe(true);
  });

  it("要約・再構成され、元ソースの長い連続文字列を含まない生成文は一致率が低く、逐語コピーと判定されない", () => {
    const source = "経験値ナーフでジャングラー涙目という意見が多数。序盤のレベル差がつきにくくなったとの声も。";
    const generated =
      "「パッチ変更の話題」というスレッドが立ち、複数のユーザーから反応が寄せられている。1件目の反応として、経験値ナーフといった趣旨のコメントが寄せられた。以上、まとめた。";
    const ratio = computeVerbatimMatchRatio(generated, source);
    expect(ratio).toBeLessThanOrEqual(DEFAULT_VERBATIM_THRESHOLD);
    expect(isVerbatimCopy(generated, source)).toBe(false);
  });

  it("元ソースが空文字なら一致率は0", () => {
    expect(computeVerbatimMatchRatio("何か生成された文章", "")).toBe(0);
  });

  it("しきい値ちょうどは逐語コピーと判定しない(超過のみコピー扱い)", () => {
    // 生成文に元ソースの一部n-gramのみを含み、ちょうど半分程度の一致率になるよう調整
    const source = "abcdefghijklmnopqrstuvwxyz"; // 26文字
    const generated = "abcdefghijklmno"; // 先頭15文字のみ含む(半分弱)
    const ratio = computeVerbatimMatchRatio(generated, source);
    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(0);
  });
});
