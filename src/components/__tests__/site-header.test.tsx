/**
 * SiteHeaderのナビ（リファクタリングS7a F-S7a-2）: categoriesプロパティで渡されたカテゴリのみを
 * リンクとして表示することを検証する（空カテゴリ非表示の結線先）。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader } from "@/components/site-header";

describe("SiteHeader（カテゴリナビの絞り込み）", () => {
  it("categoriesで渡されたカテゴリのみをナビリンクとして表示する", () => {
    const html = renderToStaticMarkup(<SiteHeader categories={["パッチ/メタ", "5chの反応"]} />);
    expect(html).toContain('href="/category/patch-meta"');
    expect(html).toContain('href="/category/5ch"');
    expect(html).not.toContain('href="/category/riot-official"');
    expect(html).not.toContain('href="/category/esports"');
    expect(html).not.toContain('href="/category/overseas"');
  });

  it("categories未指定時は従来どおり全定義カテゴリを表示する（後方互換）", () => {
    const html = renderToStaticMarkup(<SiteHeader />);
    expect(html).toContain('href="/category/patch-meta"');
    expect(html).toContain('href="/category/riot-official"');
    expect(html).toContain('href="/category/esports"');
    expect(html).toContain('href="/category/5ch"');
    expect(html).toContain('href="/category/overseas"');
  });

  it("categoriesが空配列なら記事一覧へのカテゴリリンクを1つも表示しない", () => {
    const html = renderToStaticMarkup(<SiteHeader categories={[]} />);
    expect(html).not.toContain("/category/");
  });
});
