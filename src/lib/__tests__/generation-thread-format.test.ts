import { describe, expect, it } from "vitest";
import { parseThreadReses, extractAnchors, computeLineEmphasis } from "@/lib/generation/thread-format";

describe("parseThreadReses", () => {
  it("「N: 」形式の複数レスをレス番号・本文行の配列にパースする", () => {
    const reses = parseThreadReses("1: 1行目\n2行目\n\n2: >>1\n返信本文");
    expect(reses).toEqual([
      { number: 1, lines: ["1行目", "2行目"] },
      { number: 2, lines: [">>1", "返信本文"] },
    ]);
  });

  it("空行が無くても次の「N: 」でレスが区切れる", () => {
    const reses = parseThreadReses("1: 一件目\n2: 二件目");
    expect(reses).toEqual([
      { number: 1, lines: ["一件目"] },
      { number: 2, lines: ["二件目"] },
    ]);
  });

  it("「N: 」形式に一致しない単発文は、全体を番号1の1件のレスにフォールバックする", () => {
    const reses = parseThreadReses("普通の一文だけのコンテンツです。");
    expect(reses).toEqual([{ number: 1, lines: ["普通の一文だけのコンテンツです。"] }]);
  });

  it("空文字列は空配列を返す", () => {
    expect(parseThreadReses("")).toEqual([]);
  });
});

describe("extractAnchors", () => {
  it("「>>N」形式のアンカーを出現順・重複排除で抽出する", () => {
    expect(extractAnchors([">>1", "同意 >>1", ">>3"])).toEqual([1, 3]);
  });

  it("アンカーが無ければ空配列", () => {
    expect(extractAnchors(["ただの本文"])).toEqual([]);
  });
});

describe("computeLineEmphasis", () => {
  it("キーワードに一致する最初の1行だけを赤で強調する(1レス0〜1行)", () => {
    const result = computeLineEmphasis(["普通の行", "草生えるわこれ", "神プレイすぎ"]);
    expect(result).toEqual([undefined, "red", undefined]);
  });

  it("アンカー行はオレンジで強調する(赤指定行は除く)", () => {
    const result = computeLineEmphasis([">>1", "普通の行"]);
    expect(result).toEqual(["orange", undefined]);
  });

  it("キーワード・アンカーのいずれも無い行はundefined", () => {
    expect(computeLineEmphasis(["普通の行1", "普通の行2"])).toEqual([undefined, undefined]);
  });

  it("議論系の決定的な一行（戦犯/言い訳/論破）も赤で強調する", () => {
    expect(computeLineEmphasis(["普通の行", "今回の戦犯はこいつだろ"])).toEqual([undefined, "red"]);
    expect(computeLineEmphasis(["言い訳にしか聞こえない"])).toEqual(["red"]);
    expect(computeLineEmphasis(["それは完全に論破されてる"])).toEqual(["red"]);
  });
});
