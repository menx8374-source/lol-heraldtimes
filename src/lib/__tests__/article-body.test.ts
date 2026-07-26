import { describe, expect, it } from "vitest";
import {
  blockText,
  groupArticleBodyBlocksForDisplay,
  hasStructuredHeadings,
  parseArticleBody,
  InvalidArticleBodyError,
  type ArticleBodyBlock,
  type ArticleBodyReactionBlock,
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

  it("reactionブロックのemphasis(レス単位の強調フラグ)をパースできる(拡張E25)", () => {
    const input = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "重要な反応" }],
        emphasis: true,
      },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("reactionブロックのemphasis省略時は従来どおり(拡張E25、後方互換)", () => {
    const result = parseArticleBody([
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "普通の反応" }] },
    ]);
    expect(result[0]).toEqual({
      type: "reaction",
      number: 1,
      name: "国内プレイヤーさん",
      lines: [{ text: "普通の反応" }],
    });
  });

  it("reactionブロックのemphasisが真偽値でなければエラーを投げる(拡張E25)", () => {
    expect(() =>
      parseArticleBody([
        { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "x" }], emphasis: "yes" },
      ]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("reactionブロックのemphasisColor(赤/青/紫/オレンジ)をパースできる(拡張E32、拡張E36で緑を廃止)", () => {
    const input = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "重要な反応" }],
        emphasis: true,
        emphasisColor: "blue",
      },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("reactionブロックのemphasisColor省略時は従来どおり(拡張E32、後方互換)", () => {
    const result = parseArticleBody([
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "重要な反応" }], emphasis: true },
    ]);
    expect(result[0]).toEqual({
      type: "reaction",
      number: 1,
      name: "国内プレイヤーさん",
      lines: [{ text: "重要な反応" }],
      emphasis: true,
    });
  });

  it("reactionブロックのemphasisColorが不正な値ならエラーを投げる(拡張E32)", () => {
    expect(() =>
      parseArticleBody([
        {
          type: "reaction",
          number: 1,
          name: "国内プレイヤーさん",
          lines: [{ text: "x" }],
          emphasis: true,
          emphasisColor: "pink",
        },
      ]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("reactionブロックのemphasisColorとしてpurpleを許可する(拡張E36、緑の代替として追加)", () => {
    const input = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "補足の反応" }],
        emphasis: true,
        emphasisColor: "purple",
      },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("reactionブロックのemphasisColorとしてorangeを許可する(拡張E36)", () => {
    const result = parseArticleBody([
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "強めの反応" }],
        emphasis: true,
        emphasisColor: "orange",
      },
    ]);
    expect(result[0]).toMatchObject({ emphasisColor: "orange" });
  });

  it("reactionブロックのemphasisColorとしてgreenはもう許可しない(拡張E36で緑を廃止)", () => {
    expect(() =>
      parseArticleBody([
        {
          type: "reaction",
          number: 1,
          name: "国内プレイヤーさん",
          lines: [{ text: "x" }],
          emphasis: true,
          emphasisColor: "green",
        },
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

  it("linkButtonブロックをパースできる(url/label, 拡張E42)", () => {
    const input = [
      {
        type: "linkButton",
        url: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes",
        label: "▶ パッチ26.14 公式パッチノートを読む",
      },
    ];
    const result = parseArticleBody(input);
    expect(result[0]).toEqual(input[0]);
  });

  it("linkButtonブロックのurlがhttpならエラーを投げる(拡張E42、https必須)", () => {
    expect(() =>
      parseArticleBody([{ type: "linkButton", url: "http://example.com/patch-notes", label: "公式サイトへ" }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("linkButtonブロックのurlがjavascript:スキームならエラーを投げる(拡張E42)", () => {
    expect(() =>
      parseArticleBody([{ type: "linkButton", url: "javascript:alert(1)", label: "危険リンク" }]),
    ).toThrow(InvalidArticleBodyError);
  });

  it("linkButtonブロックのlabelが空ならエラーを投げる(拡張E42)", () => {
    expect(() =>
      parseArticleBody([{ type: "linkButton", url: "https://example.com/", label: "" }]),
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

  it("linkButtonはlabel＋urlを改行連結して返す(拡張E42、検索・文字数計算・安全フィルタ対象に含める)", () => {
    expect(
      blockText({ type: "linkButton", url: "https://example.com/patch-notes", label: "公式パッチノートを読む" }),
    ).toBe("公式パッチノートを読む\nhttps://example.com/patch-notes");
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

describe("groupArticleBodyBlocksForDisplay（レスの1枠統合, 拡張E12）", () => {
  const reaction = (number: number): ArticleBodyReactionBlock => ({
    type: "reaction",
    number,
    name: "国内プレイヤーさん",
    lines: [{ text: `レス${number}` }],
  });

  it("連続する reaction ブロックを1つの reaction-group にまとめる", () => {
    const blocks: ArticleBodyBlock[] = [reaction(1), reaction(2), reaction(3)];
    const groups = groupArticleBodyBlocksForDisplay(blocks);
    expect(groups).toEqual([
      { kind: "reaction-group", blocks: [reaction(1), reaction(2), reaction(3)], startIndex: 0 },
    ]);
  });

  it("reaction が無ければ全て single のまま、元のインデックスを保持する", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "本文" },
    ];
    const groups = groupArticleBodyBlocksForDisplay(blocks);
    expect(groups).toEqual([
      { kind: "single", block: blocks[0], index: 0 },
      { kind: "single", block: blocks[1], index: 1 },
    ]);
  });

  it("heading等を挟んで非連続な reaction は、まとまりごとに別々のグループになる", () => {
    const blocks: ArticleBodyBlock[] = [
      reaction(1),
      reaction(2),
      { type: "heading", text: "次のトピック" },
      reaction(3),
    ];
    const groups = groupArticleBodyBlocksForDisplay(blocks);
    expect(groups).toEqual([
      { kind: "reaction-group", blocks: [reaction(1), reaction(2)], startIndex: 0 },
      { kind: "single", block: blocks[2], index: 2 },
      { kind: "reaction-group", blocks: [reaction(3)], startIndex: 3 },
    ]);
  });

  it("先頭・末尾が非reactionで中間にreactionが混在するケース", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "paragraph", text: "導入" },
      reaction(1),
      { type: "paragraph", text: "まとめ" },
    ];
    const groups = groupArticleBodyBlocksForDisplay(blocks);
    expect(groups).toEqual([
      { kind: "single", block: blocks[0], index: 0 },
      { kind: "reaction-group", blocks: [reaction(1)], startIndex: 1 },
      { kind: "single", block: blocks[2], index: 2 },
    ]);
  });
});
