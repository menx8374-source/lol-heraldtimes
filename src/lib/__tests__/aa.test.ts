import { describe, expect, it } from "vitest";
import { isAsciiArtLine } from "@/lib/aa";

describe("isAsciiArtLine（AA検出ヒューリスティック, 拡張E3）", () => {
  it("単純な顔文字は通常テキスト扱い(AAと判定しない)", () => {
    expect(isAsciiArtLine("これは祝勝ムード全開だわ(^^)/")).toBe(false);
    expect(isAsciiArtLine("(^^)")).toBe(false);
  });

  it("通常の日本語文はAAと判定しない", () => {
    expect(isAsciiArtLine("普通のコメントです。")).toBe(false);
    expect(isAsciiArtLine("次のパッチでどう調整されるか楽しみにしてる。")).toBe(false);
  });

  it("罫線・記号を反復する行はAAと判定する", () => {
    expect(isAsciiArtLine("   _____")).toBe(true);
    expect(isAsciiArtLine("  |_____|")).toBe(true);
    expect(isAsciiArtLine("━━━━━")).toBe(true);
  });

  it("縦棒＋位置合わせの連続スペースを含む行はAAと判定する", () => {
    expect(isAsciiArtLine("  |     |")).toBe(true);
    expect(isAsciiArtLine("  | GG! |")).toBe(true);
  });

  it("AA用記号を2種類以上含む行はAAと判定する", () => {
    expect(isAsciiArtLine("┌─────┐")).toBe(true);
  });

  it("空文字・単純な>>Nアンカー行はAAと判定しない", () => {
    expect(isAsciiArtLine("")).toBe(false);
    expect(isAsciiArtLine(">>1")).toBe(false);
  });
});
