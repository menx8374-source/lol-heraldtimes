import { describe, expect, it } from "vitest";
import {
  parseThreadReses,
  extractAnchors,
  computeLineEmphasis,
  isPureAnchorLine,
  hasNonAnchorLine,
} from "@/lib/generation/thread-format";

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

describe("parseThreadReses（resel-S1 F-RS1-1: score注釈）", () => {
  it("「N (score:M): 」形式はscore付きでパースされる", () => {
    const reses = parseThreadReses("2 (score:15): 良いコメント\n2行目");
    expect(reses).toEqual([{ number: 2, lines: ["良いコメント", "2行目"], score: 15 }]);
  });

  it("負のscoreも読み取る", () => {
    const reses = parseThreadReses("3 (score:-7): 賛否両論のコメント");
    expect(reses).toEqual([{ number: 3, lines: ["賛否両論のコメント"], score: -7 }]);
  });

  it("score注釈の無い既存「N: 」形式はscore=undefinedのまま（回帰なし）", () => {
    const reses = parseThreadReses("1: 通常のレス");
    expect(reses).toHaveLength(1);
    expect(reses[0].score).toBeUndefined();
    expect(reses[0]).toEqual({ number: 1, lines: ["通常のレス"] });
  });

  it("score注釈は本文(lines)に混入しない", () => {
    const reses = parseThreadReses("5 (score:3): 本文だけが入る");
    expect(reses[0].lines).toEqual(["本文だけが入る"]);
    expect(reses[0].lines.join(" ")).not.toContain("score");
  });

  it("score付き複数レス・>>Nアンカー・OPパースが従来どおり回帰しない", () => {
    const reses = parseThreadReses("1: OP本文\n\n2 (score:20): >>1\n返信本文\n\n3: 注釈なしレス");
    expect(reses).toEqual([
      { number: 1, lines: ["OP本文"] },
      { number: 2, lines: [">>1", "返信本文"], score: 20 },
      { number: 3, lines: ["注釈なしレス"] },
    ]);
  });
});

describe("parseThreadReses（resel-S1 FAIL修正: parent注釈のパース）", () => {
  it("「N (score:M parent:P): 」形式はscoreとparentNumberの両方をパースする", () => {
    const reses = parseThreadReses("3 (score:5 parent:2): 返信本文");
    expect(reses).toEqual([{ number: 3, lines: ["返信本文"], score: 5, parentNumber: 2 }]);
  });

  it("「N (parent:P): 」形式（scoreなし）はparentNumberのみパースする", () => {
    const reses = parseThreadReses("4 (parent:1): 親のみの注釈");
    expect(reses).toEqual([{ number: 4, lines: ["親のみの注釈"], parentNumber: 1 }]);
  });

  it("「N (score:M): 」形式（parentなし）はscoreのみでparentNumberはundefined", () => {
    const reses = parseThreadReses("5 (score:9): scoreのみ");
    expect(reses[0].score).toBe(9);
    expect(reses[0].parentNumber).toBeUndefined();
  });

  it("注釈なし「N: 」形式はscore・parentNumberともにundefined", () => {
    const reses = parseThreadReses("6: 注釈なし");
    expect(reses[0].score).toBeUndefined();
    expect(reses[0].parentNumber).toBeUndefined();
    expect(reses[0]).toEqual({ number: 6, lines: ["注釈なし"] });
  });

  it("score/parent注釈はいずれもlines(本文)に混入しない", () => {
    const reses = parseThreadReses("7 (score:3 parent:1): 本文だけが入る");
    expect(reses[0].lines).toEqual(["本文だけが入る"]);
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

describe("isPureAnchorLine（reactqual-S3 F-RQ3-1）", () => {
  it("「>>N」のみの行はtrue", () => {
    expect(isPureAnchorLine(">>101")).toBe(true);
    expect(isPureAnchorLine("  >>1  ")).toBe(true);
  });

  it("本文を伴う行はfalse", () => {
    expect(isPureAnchorLine("グレイブスのスモークスクリーンか？")).toBe(false);
    expect(isPureAnchorLine(">>101 それな")).toBe(false);
  });

  it("空文字はfalse（非アンカー扱い）", () => {
    expect(isPureAnchorLine("")).toBe(false);
    expect(isPureAnchorLine("   ")).toBe(false);
  });
});

describe("hasNonAnchorLine（reactqual-S3 F-RQ3-1）", () => {
  it("アンカーのみの行だけで構成される場合はfalse", () => {
    expect(hasNonAnchorLine([">>101"])).toBe(false);
    expect(hasNonAnchorLine([">>101", "  "])).toBe(false);
  });

  it("非アンカーの非空行が1つでもあればtrue", () => {
    expect(hasNonAnchorLine([">>101", "グレイブスのスモークスクリーンか？"])).toBe(true);
    expect(hasNonAnchorLine(["本文のみ"])).toBe(true);
  });

  it("空配列・空行のみはfalse", () => {
    expect(hasNonAnchorLine([])).toBe(false);
    expect(hasNonAnchorLine(["", "  "])).toBe(false);
  });
});
