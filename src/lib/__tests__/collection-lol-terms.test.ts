/**
 * containsLoLTerm（reactqual-S1 F-RQ1-2、精度改善リファインメント）の単体テスト。
 * 「裸"lol"（笑）を弾き、LoL固有語のみを通す」ことに加え、
 * ASCII略語の部分一致誤爆（"lec"⊂"election"等）を単語境界一致で解消し、
 * "世界大会"/"ヤスオ"の誤除外を解消することを検証する。
 */
import { describe, expect, it } from "vitest";
import { containsLoLTerm } from "@/lib/collection/lol-terms";

describe("containsLoLTerm", () => {
  it("LoL固有語（正式名称・日本語表記・チャンピオン名・ハッシュタグ）を含む文はtrue", () => {
    expect(containsLoLTerm("League of Legends面白い")).toBe(true);
    expect(containsLoLTerm("アジール強すぎ")).toBe(true);
    expect(containsLoLTerm("#LoL 今日のランク")).toBe(true);
    expect(containsLoLTerm("リーグ・オブ・レジェンドの新シーズン")).toBe(true);
    expect(containsLoLTerm("LJLの決勝、最高だった")).toBe(true);
    expect(containsLoLTerm("ゼドが強い")).toBe(true);
    expect(containsLoLTerm("ヤスオのアウトプレイ")).toBe(true);
    expect(containsLoLTerm("世界大会の決勝")).toBe(true);
  });

  it("裸の\"lol\"（笑）しか含まない文はfalse（誤ヒットの根絶）", () => {
    expect(containsLoLTerm("lol that's so funny")).toBe(false);
    expect(containsLoLTerm("草www lol")).toBe(false);
    expect(containsLoLTerm("just lol")).toBe(false);
  });

  it("大小文字を無視して判定する", () => {
    expect(containsLoLTerm("LEAGUE OF LEGENDS is great")).toBe(true);
    expect(containsLoLTerm("#LEAGUEOFLEGENDS today")).toBe(true);
  });

  it("空文字はfalse", () => {
    expect(containsLoLTerm("")).toBe(false);
  });

  it("ASCII略語の部分一致による誤検出を解消する（単語境界一致）", () => {
    expect(containsLoLTerm("The election was rigged, lol")).toBe(false);
    expect(containsLoLTerm("I bought a new MSI laptop")).toBe(false);
    expect(containsLoLTerm("アーリーアクセス")).toBe(false);
  });

  it("単語境界群（ljl/lck/lpl/lec）は境界を跨がない一致のみtrue", () => {
    // 他のASCII単語に埋め込まれている場合はfalse
    expect(containsLoLTerm("riljleague")).toBe(false);
    // 日本語に隣接していれば境界成立でtrue
    expect(containsLoLTerm("リーグljl配信")).toBe(true);
  });
});
