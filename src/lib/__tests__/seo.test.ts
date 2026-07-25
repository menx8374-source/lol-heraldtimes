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

describe("buildArticleExcerpt（記事カードの本文抜粋, 拡張E1）", () => {
  it("buildArticleDescriptionより短い上限（80字）で切り詰める", () => {
    const longText = "あ".repeat(200);
    const blocks: ArticleBodyBlock[] = [{ type: "paragraph", text: longText }];
    const result = buildArticleExcerpt(blocks);
    expect(result.length).toBe(81); // 80文字 + "…"
    expect(result.endsWith("…")).toBe(true);
  });

  it("短い本文はそのまま返す（切り詰めない）", () => {
    const blocks: ArticleBodyBlock[] = [{ type: "paragraph", text: "短い本文の段落です。" }];
    expect(buildArticleExcerpt(blocks)).toBe("短い本文の段落です。");
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
