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

  it("複数レスを個別のブロックとして描画する", () => {
    expect(html.indexOf("1: ")).toBeLessThan(html.indexOf("2: "));
  });
});
