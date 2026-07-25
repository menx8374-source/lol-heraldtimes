import { describe, expect, it } from "vitest";
import {
  buildArticleDescription,
  buildArticleExcerpt,
  buildBreadcrumbJsonLd,
  toSafeJsonLd,
} from "@/lib/seo";
import type { ArticleBodyBlock } from "@/lib/article-body";

describe("buildArticleDescription", () => {
  it("最初の段落ブロックのテキストを使う（見出し・引用は使わない）", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "見出し" },
      { type: "paragraph", text: "これが本文の要約に使われる段落です。" },
      { type: "quote", text: "引用は使わない", source: "Reddit" },
    ];
    expect(buildArticleDescription(blocks)).toBe("これが本文の要約に使われる段落です。");
  });

  it("段落が無い場合は最初のブロックのテキストにフォールバックする", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "heading", text: "見出しだけの記事" }];
    expect(buildArticleDescription(blocks)).toBe("見出しだけの記事");
  });

  it("上限長を超える場合は省略記号付きで切り詰める", () => {
    const longText = "あ".repeat(200);
    const blocks: ArticleBodyBlock[] = [{ type: "paragraph", text: longText }];
    const result = buildArticleDescription(blocks);
    expect(result.length).toBe(121); // 120文字 + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("連続する空白・改行を1つの半角スペースに正規化する", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "paragraph", text: "行1\n\n行2   行3" }];
    expect(buildArticleDescription(blocks)).toBe("行1 行2 行3");
  });
});

describe("buildArticleExcerpt（記事カードの本文抜粋, 拡張E1・E9）", () => {
  it("reactionブロックが無い場合はbuildArticleDescriptionより短い上限（100字）で切り詰める", () => {
    const longText = "あ".repeat(200);
    const blocks: ArticleBodyBlock[] = [{ type: "paragraph", text: longText }];
    const result = buildArticleExcerpt(blocks);
    expect(result.length).toBe(101); // 100文字 + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("短い本文はそのまま返す（切り詰めない）", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "paragraph", text: "短い本文の段落です。" }];
    expect(buildArticleExcerpt(blocks)).toBe("短い本文の段落です。");
  });

  it("reactionブロックを含む記事は「1レス目の本文」から抜粋する（段落より優先）", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "反応まとめ" },
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: "新チャンピオンの調整が来た、これは強すぎる" }],
      },
      {
        type: "reaction",
        number: 2,
        name: "国内プレイヤーさん",
        lines: [{ text: "確かに強そう" }],
      },
    ];
    expect(buildArticleExcerpt(blocks)).toBe("新チャンピオンの調整が来た、これは強すぎる");
  });

  it("reaction ブロックの出現順に関わらずレス番号(number)が最小のものを1レス目として使う", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "reaction", number: 3, name: "海外プレイヤーさん", lines: [{ text: "3番目のレス" }] },
      { type: "reaction", number: 1, name: "海外プレイヤーさん", lines: [{ text: "1番目のレスの本文" }] },
    ];
    expect(buildArticleExcerpt(blocks)).toBe("1番目のレスの本文");
  });

  it("`>>N` だけのアンカー行は抜粋から除外し、実際の発言内容を使う", () => {
    const blocks: ArticleBodyBlock[] = [
      {
        type: "reaction",
        number: 1,
        name: "国内プレイヤーさん",
        lines: [{ text: ">>0" }, { text: "これが1レス目の実際の発言内容です" }],
      },
    ];
    expect(buildArticleExcerpt(blocks)).toBe("これが1レス目の実際の発言内容です");
  });

  it("reactionブロックを持たない記事（Riot公式形式）は本文冒頭段落からの抜粋にフォールバックする", () => {
    const blocks: ArticleBodyBlock[] = [
      { type: "heading", text: "速報" },
      { type: "paragraph", text: "新パッチの詳細が公式から発表された。" },
    ];
    expect(buildArticleExcerpt(blocks)).toBe("新パッチの詳細が公式から発表された。");
  });
});

describe("toSafeJsonLd", () => {
  it("通常のオブジェクトは通常のJSONとして直列化される", () => {
    const json = toSafeJsonLd({ headline: "タイトル", articleSection: "パッチ/メタ" });
    expect(JSON.parse(json)).toEqual({ headline: "タイトル", articleSection: "パッチ/メタ" });
  });

  it("値に </script> を含んでいてもスクリプトタグを早期終了させない", () => {
    const json = toSafeJsonLd({ headline: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("</script>");
    expect(json).not.toContain("<script>");
    // エスケープしても中身（デコード後）は元の文字列を保つ
    expect(JSON.parse(json.replace(/\\u003c/g, "<"))).toEqual({
      headline: "</script><script>alert(1)</script>",
    });
  });
});

describe("buildBreadcrumbJsonLd（パンくずリスト構造化データ, 拡張E4）", () => {
  it("BreadcrumbList形式で、位置(position)は1始まりの連番、itemは絶対URLになる", () => {
    const jsonLd = buildBreadcrumbJsonLd(
      [
        { name: "トップ", path: "/" },
        { name: "パッチ/メタ", path: "/category/patch-meta" },
        { name: "テスト記事", path: "/articles/test-slug" },
      ],
      "https://example.com",
    );

    expect(jsonLd["@type"]).toBe("BreadcrumbList");
    expect(jsonLd.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "トップ", item: "https://example.com" },
      {
        "@type": "ListItem",
        position: 2,
        name: "パッチ/メタ",
        item: "https://example.com/category/patch-meta",
      },
      {
        "@type": "ListItem",
        position: 3,
        name: "テスト記事",
        item: "https://example.com/articles/test-slug",
      },
    ]);
  });

  it("toSafeJsonLd と組み合わせると、名前にスクリプトタグが混入していても安全に埋め込める", () => {
    const jsonLd = buildBreadcrumbJsonLd(
      [{ name: "</script><script>alert(1)</script>", path: "/" }],
      "https://example.com",
    );
    const json = toSafeJsonLd(jsonLd);
    expect(json).not.toContain("</script>");
    expect(json).not.toContain("<script>");
  });
});
