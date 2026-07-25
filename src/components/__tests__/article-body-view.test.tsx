import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleBodyView } from "@/components/article-body-view";
import type { ArticleBodyBlock } from "@/lib/article-body";

const blocks: ArticleBodyBlock[] = [
  { type: "heading", text: "見出し" },
  { type: "paragraph", text: "これは自サイトが生成した本文段落です。" },
  { type: "quote", text: "海外の反応: とても強いチャンピオンだ", source: "Redditの反応" },
];

describe("ArticleBodyView", () => {
  const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);

  it("引用ブロックを blockquote で描画し、自サイト生成の段落とは別要素にする（F15）", () => {
    expect(html).toContain("<blockquote");
    expect(html).toContain("海外の反応: とても強いチャンピオンだ");
  });

  it("引用に「引用」ラベルと出典元表記を明示する（F15）", () => {
    expect(html).toContain("引用");
    expect(html).toContain("Redditの反応");
  });

  it("通常の段落は blockquote に含まれない", () => {
    const paragraphIndex = html.indexOf("これは自サイトが生成した本文段落です。");
    const blockquoteOpenIndex = html.indexOf("<blockquote");
    const blockquoteCloseIndex = html.indexOf("</blockquote>");
    // 段落の出現位置が blockquote の外側（開始タグより前 or 終了タグより後）であることを確認する。
    const insideBlockquote =
      paragraphIndex > blockquoteOpenIndex && paragraphIndex < blockquoteCloseIndex;
    expect(insideBlockquote).toBe(false);
  });
});

describe("ArticleBodyView（reactionブロック=まとめ速報レス形式）", () => {
  const reactionBlocks: ArticleBodyBlock[] = [
    {
      type: "reaction",
      number: 1,
      name: "国内プレイヤーさん",
      lines: [{ text: "普通の行" }, { text: "神プレイすぎる", emphasis: "red" }],
    },
    {
      type: "reaction",
      number: 2,
      name: "国内プレイヤーさん",
      lines: [{ text: ">>1", emphasis: "orange" }],
      anchors: [1],
    },
  ];
  const html = renderToStaticMarkup(<ArticleBodyView blocks={reactionBlocks} />);

  it("「番号: 名前」を表示し、名前は緑系クラスで描画する", () => {
    expect(html).toContain("1: ");
    expect(html).toContain("国内プレイヤーさん");
    expect(html).toContain("text-green-700");
  });

  it("重要行を赤クラスで、アンカー(>>N)行をオレンジクラスで強調する", () => {
    expect(html).toContain("神プレイすぎる");
    expect(html).toContain("text-red-600");
    // ">>1" はHTMLエスケープされて "&gt;&gt;1" として出力される
    expect(html).toContain("&gt;&gt;1");
    expect(html).toContain("text-orange-600");
  });

  it("複数レスを出現順に描画する", () => {
    expect(html.indexOf("1: ")).toBeLessThan(html.indexOf("2: "));
  });
});

describe("ArticleBodyView（連続レスの1枠統合, 拡張E12）", () => {
  it("連続する reaction ブロックは1つのコンテナ(divide-y)にまとまり、区切り線で仕切られる", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "レス1" }] },
      { type: "reaction", number: 2, name: "国内プレイヤーさん", lines: [{ text: "レス2" }] },
      { type: "reaction", number: 3, name: "国内プレイヤーさん", lines: [{ text: "レス3" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    // 3レスとも1つの区切り線コンテナ内に収まっている（レスごとの独立した角丸ボックスではない）
    expect(html.match(/divide-y/g)?.length).toBe(1);
    expect(html.indexOf("1: ")).toBeLessThan(html.indexOf("2: "));
    expect(html.indexOf("2: ")).toBeLessThan(html.indexOf("3: "));
  });

  it("heading等を挟んで非連続な reaction は、まとまりごとに別枠になる", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "レス1" }] },
      { type: "reaction", number: 2, name: "国内プレイヤーさん", lines: [{ text: "レス2" }] },
      { type: "heading", text: "次の話題" },
      { type: "reaction", number: 3, name: "国内プレイヤーさん", lines: [{ text: "レス3" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    // 2つの独立したグループ(枠)ができる
    expect(html.match(/divide-y/g)?.length).toBe(2);
  });

  it("reaction以外のブロック(heading/paragraph/quote/image/embed)の表示は従来どおり", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "段落本文" },
      { type: "reaction", number: 1, name: "国内プレイヤーさん", lines: [{ text: "レス1" }] },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("<h2");
    expect(html).toContain("見出し");
    expect(html).toContain("段落本文");
  });
});

describe("ArticleBodyView（画像ブロック, 拡張E3）", () => {
  const blocksWithImage: ArticleBodyBlock[] = [
    { type: "image", url: "/mock-images/sample.svg", alt: "サンプル画像の説明", credit: "画像: 編集部" },
  ];
  const html = renderToStaticMarkup(<ArticleBodyView blocks={blocksWithImage} />);

  it("<img>にsrc/alt/loading=lazy/decoding=asyncを設定する", () => {
    expect(html).toContain('src="/mock-images/sample.svg"');
    expect(html).toContain('alt="サンプル画像の説明"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
  });

  it("クレジット(出典)をキャプションとして表示する", () => {
    expect(html).toContain("<figcaption");
    expect(html).toContain("画像: 編集部");
  });

  it("dangerouslySetInnerHTMLをprop(JSX属性)として使わない(コンポーネントソースにも不在)", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(new URL("../article-body-view.tsx", import.meta.url), "utf-8");
    // コメント文中の言及(「〜は使わない」という注記)は許容し、実際の属性使用(`dangerouslySetInnerHTML=`)のみを禁止する。
    expect(src).not.toContain("dangerouslySetInnerHTML=");
  });
});

describe("ArticleBodyView（埋め込みブロック, 拡張E3）", () => {
  it("正当なprovider/urlはプレースホルダーカードとして表示し、元URLへのリンクと注記を含む", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "embed", provider: "youtube", url: "https://www.youtube.com/watch?v=abc", caption: "サンプル動画" },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("YouTube");
    expect(html).toContain("サンプル動画");
    expect(html).toContain("https://www.youtube.com/watch?v=abc");
    expect(html).toContain("本番接続時に表示されます");
    // 実iframe/scriptを読み込まない
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<script");
  });

  it("ホワイトリスト外のURLを持つ埋め込みブロックは描画しない(不正データが混入した場合の二重防御)", () => {
    // parseArticleBodyを経由せず直接不正な埋め込みブロックをArticleBodyViewに渡すケースを想定
    const blocks = [
      { type: "embed", provider: "youtube", url: "https://evil.example/watch" },
    ] as unknown as ArticleBodyBlock[];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("evil.example");
  });
});

describe("ResLines（AA・原文併記, 拡張E3）", () => {
  it("AAらしい行は等幅フォント(font-mono)クラスを付与する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "   _____" }, { text: "  | GG! |" }],
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("font-mono");
  });

  it("単純な顔文字はfont-monoクラスを付与しない(崩れず通常テキスト表示)", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "祝勝ムード全開だわ(^^)/" }],
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).not.toContain("font-mono");
    expect(html).toContain("(^^)/");
  });

  it("originalがある行は「原文: ...（英語）」を日本語訳の前に表示する", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "海外プレイヤーさん",
        lines: [{ text: "強すぎる。", original: "It is too strong." }],
      },
    ];
    const html = renderToStaticMarkup(<ArticleBodyView blocks={blocks} />);
    expect(html).toContain("原文: It is too strong.（英語）");
    const originalIndex = html.indexOf("原文: It is too strong.");
    const translatedIndex = html.indexOf("強すぎる。");
    expect(originalIndex).toBeLessThan(translatedIndex);
  });
});
