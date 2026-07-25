import { describe, expect, it } from "vitest";
import {
  blockText,
  hasStructuredHeadings,
  parseArticleBody,
  InvalidArticleBodyError,
} from "@/lib/article-body";

describe("parseArticleBody", () => {
  it("見出し・段落・引用が混在する正しい構造をパースできる", () => {
    const input = [
      { type: "heading", text: "導入" },
      { type: "paragraph", text: "海外のフォーラムでは大きな話題になっている。" },
      { type: "quote", text: "このチャンピオンは強すぎる", source: "Reddit" },
    ];

    const result = parseArticleBody(input);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "heading", text: "導入" });
    expect(result[2]).toMatchObject({ type: "quote", source: "Reddit" });
  });

  it("配列でない値は不正としてエラーを投げる（長文ベタ書き対策）", () => {
    expect(() => parseArticleBody("ただの長い文字列です")).toThrow(
      InvalidArticleBodyError,
    );
  });

  it("空配列はエラーを投げる", () => {
    expect(() => parseArticleBody([])).toThrow(InvalidArticleBodyError);
  });

  it("未知の type はエラーを投げる", () => {
    expect(() => parseArticleBody([{ type: "video", text: "x" }])).toThrow(
      InvalidArticleBodyError,
    );
  });

  it("text が空文字のブロックはエラーを投げる", () => {
    expect(() => parseArticleBody([{ type: "paragraph", text: "" }])).toThrow(
      InvalidArticleBodyError,
    );
  });

  it("reaction(まとめ速報レス)ブロックをパースできる(番号・名前・複数行・強調・アンカー)", () => {
    const input = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "本文1行目" }, { text: "神プレイすぎる", emphasis: "red" }],
      },
      {
        type: "reaction",
        number: 2,
        name: "国内プレイヤーさん",
        lines: [{ text: ">>1", emphasis: "orange" }],
        anchors: [1],
      },
    ];
    const result = parseArticleBody(input);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(input[0]);
    expect(result[1]).toEqual(input[1]);
  });

  it("reactionブロックのnumberが不正(0以下・非整数)ならエラーを投げる", () => {
    expect(() =>
      parseArticleBody([{ type: "reaction", number: 0, name: "国内プレイヤーさん", lines: [{ text: "x" }] }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("reactionブロックのnameが空ならエラーを投げる", () => {
    expect(() =>
      parseArticleBody([{ type: "reaction", number: 1, name: "", lines: [{ text: "x" }] }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("reactionブロックのlinesが空配列ならエラーを投げる", () => {
    expect(() =>
      parseArticleBody([{ type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [] }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("reactionブロックのemphasisが不正な値ならエラーを投げる", () => {
    expect(() =>
      parseArticleBody([
        { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "x", emphasis: "blue" }] },
      ]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("reactionブロックのlines[].originalで原文併記(海外の反応)をパースできる(拡張E3)", () => {
    const input = [
      {
        type: "reaction",
        number: 1,
        name: "海外プレイヤーさん",
        lines: [{ text: "強すぎる。", original: "It is too strong." }],
      },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("reactionブロックのlines[].originalが空文字ならエラーを投げる(拡張E3)", () => {
    expect(() =>
      parseArticleBody([
        { type: "reaction", number: 1, name: "海外プレイヤーさん", lines: [{ text: "x", original: "" }] },
      ]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("画像ブロックをパースできる(url/alt/credit, 拡張E3)", () => {
    const input = [
      { type: "image", url: "/mock-images/sample.svg", alt: "サンプル画像", credit: "画像: 編集部" },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("画像ブロックはcredit省略可(拡張E3)", () => {
    const result = parseArticleBody([{ type: "image", url: "/mock-images/sample.svg", alt: "サンプル画像" }]);
    expect(result[0]).toEqual({ type: "image", url: "/mock-images/sample.svg", alt: "サンプル画像" });
  });

  it("画像ブロックのurlがjavascript:スキーム等の危険な値ならエラーを投げる(拡張E3)", () => {
    expect(() =>
      parseArticleBody([{ type: "image", url: "javascript:alert(1)", alt: "x" }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("画像ブロックのurlがdata:image/*なら許可する(拡張E3)", () => {
    const url = "data:image/svg+xml;base64,PHN2Zy8+";
    const result = parseArticleBody([{ type: "image", url, alt: "x" }]);
    expect(result[0]).toEqual({ type: "image", url, alt: "x" });
  });

  it("画像ブロックのaltが空ならエラーを投げる(拡張E3)", () => {
    expect(() => parseArticleBody([{ type: "image", url: "/x.svg", alt: "" }])).toThrow(
      InvalidArticleBodyError,
    );
  });

  it("埋め込みブロックをパースできる(provider/url/caption, 拡張E3)", () => {
    const input = [
      {
        type: "embed",
        provider: "youtube",
        url: "https://www.youtube.com/watch?v=abc",
        caption: "サンプル動画",
      },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("埋め込みブロックのproviderが不正ならエラーを投げる(拡張E3)", () => {
    expect(() =>
      parseArticleBody([{ type: "embed", provider: "facebook", url: "https://facebook.com/x" }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("埋め込みブロックのurlがホワイトリスト外ならエラーを投げる(拡張E3)", () => {
    expect(() =>
      parseArticleBody([{ type: "embed", provider: "youtube", url: "https://evil.example/watch" }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("埋め込みブロックのurlがhttpならエラーを投げる(拡張E3)", () => {
    expect(() =>
      parseArticleBody([{ type: "embed", provider: "twitter", url: "http://twitter.com/x/status/1" }]),
    ).toThrow(InvalidArticleBodyError);
  });
});

describe("blockText", () => {
  it("heading/paragraph/quoteはtextをそのまま返す", () => {
    expect(blockText({ type: "paragraph", text: "本文" })).toBe("本文");
  });

  it("reactionは名前＋各行を改行連結して返す(安全フィルタ・検索の対象にレス本文も含めるため)", () => {
    const block = {
      type: "reaction" as const,
      number: 1,
      name: "国内プレイヤーさん",
      lines: [{ text: "1行目" }, { text: "2行目" }],
    };
    expect(blockText(block)).toBe("国内プレイヤーさん\n1行目\n2行目");
  });

  it("reactionのlines[].originalがあれば原文もテキストに含める(拡張E3・検索/安全フィルタ対象に含める)", () => {
    const block = {
      type: "reaction" as const,
      number: 1,
      name: "海外プレイヤーさん",
      lines: [{ text: "強すぎる。", original: "It is too strong." }],
    };
    expect(blockText(block)).toBe("海外プレイヤーさん\nIt is too strong.\n強すぎる。");
  });

  it("imageはalt＋creditを改行連結して返す(拡張E3)", () => {
    expect(blockText({ type: "image", url: "/x.svg", alt: "サンプル画像", credit: "画像: 編集部" })).toBe(
      "サンプル画像\n画像: 編集部",
    );
  });

  it("imageはcredit省略時altのみ返す(拡張E3)", () => {
    expect(blockText({ type: "image", url: "/x.svg", alt: "サンプル画像" })).toBe("サンプル画像");
  });

  it("embedはcaption＋urlを改行連結して返す(拡張E3)", () => {
    expect(
      blockText({ type: "embed", provider: "youtube", url: "https://youtu.be/abc", caption: "サンプル動画" }),
    ).toBe("サンプル動画\nhttps://youtu.be/abc");
  });
});

describe("hasStructuredHeadings", () => {
  it("heading ブロックが1件以上あれば true", () => {
    const blocks = parseArticleBody([
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "本文" },
    ]);
    expect(hasStructuredHeadings(blocks)).toBe(true);
  });

  it("heading が無ければ false", () => {
    const blocks = parseArticleBody([{ type: "paragraph", text: "本文だけ" }]);
    expect(hasStructuredHeadings(blocks)).toBe(false);
  });
});
