import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleThumbnail } from "@/components/article-thumbnail";

describe("ArticleThumbnail（拡張E31 テスト4: カテゴリ別既定画像フォールバック）", () => {
  it("thumbnailUrlが有効なURLならそれをそのまま表示する", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl="https://example.com/img.jpg" category="パッチ/メタ" />,
    );
    expect(html).toContain('src="https://example.com/img.jpg"');
  });

  it("thumbnailUrlが無効(null)でカテゴリが既知なら、カテゴリ別の既定サムネイルを表示する", () => {
    const cases: Array<[string, string]> = [
      ["パッチ/メタ", "/default-thumb-patch-meta.svg"],
      ["5chの反応", "/default-thumb-5ch.svg"],
      ["海外の反応", "/default-thumb-overseas.svg"],
      ["eスポーツ", "/default-thumb-esports.svg"],
    ];
    for (const [category, expectedSrc] of cases) {
      const html = renderToStaticMarkup(<ArticleThumbnail thumbnailUrl={null} category={category} />);
      expect(html).toContain(`src="${expectedSrc}"`);
    }
  });

  it("thumbnailUrlが不正なURL(https以外)でもカテゴリ別の既定サムネイルにフォールバックする", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl="http://example.com/not-https.jpg" category="eスポーツ" />,
    );
    expect(html).toContain('src="/default-thumb-esports.svg"');
  });

  it("カテゴリ不明(未指定/未知の値)のときは従来の汎用既定サムネイルを表示する", () => {
    const noCategoryHtml = renderToStaticMarkup(<ArticleThumbnail thumbnailUrl={null} />);
    expect(noCategoryHtml).toContain('src="/default-thumb.svg"');

    const unknownCategoryHtml = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="未知のカテゴリ" />,
    );
    expect(unknownCategoryHtml).toContain('src="/default-thumb.svg"');
  });
});
