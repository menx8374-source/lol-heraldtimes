import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { pickDeterministicChampionSplashUrl } from "@/lib/generation/champion-splash";

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
      ["Riot公式", "/default-thumb-riot-official.svg"],
      ["eスポーツ", "/default-thumb-esports.svg"],
      ["Xの反応", "/default-thumb-x.svg"],
    ];
    for (const [category, expectedSrc] of cases) {
      const html = renderToStaticMarkup(<ArticleThumbnail thumbnailUrl={null} category={category} />);
      expect(html).toContain(`src="${expectedSrc}"`);
    }
  });

  it("thumbnailUrlが不正なURL(https以外)でもカテゴリ別の既定サムネイルにフォールバックする", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl="http://example.com/not-https.jpg" category="パッチ/メタ" />,
    );
    expect(html).toContain('src="/default-thumb-patch-meta.svg"');
  });

  it("カテゴリ不明(未指定/未知の値)のときは従来の汎用既定サムネイルを表示する", () => {
    const noCategoryHtml = renderToStaticMarkup(<ArticleThumbnail thumbnailUrl={null} />);
    expect(noCategoryHtml).toContain('src="/default-thumb.svg"');

    const unknownCategoryHtml = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="未知のカテゴリ" />,
    );
    expect(unknownCategoryHtml).toContain('src="/default-thumb.svg"');
  });

  it("リファクタリングS7a: 「eスポーツ」はE45での削除→再追加を経て既知カテゴリとなり、専用の既定サムネイルを表示する", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="eスポーツ" />,
    );
    expect(html).toContain('src="/default-thumb-esports.svg"');
  });
});

describe("ArticleThumbnail（拡張E38 テスト3: 反応記事サムネの表示側フォールバック）", () => {
  it("thumbnailUrl=null + 反応カテゴリ + slug指定 → チャンピオンスプラッシュ(_0.jpg)を表示する（カテゴリSVGではない）", () => {
    const slug = "reaction-article-slug-1";
    const html = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="5chの反応" slug={slug} />,
    );
    const expectedSrc = pickDeterministicChampionSplashUrl(slug);
    expect(expectedSrc).toMatch(/splash\/[A-Za-z]+_0\.jpg$/);
    expect(html).toContain(`src="${expectedSrc}"`);
    expect(html).not.toContain("/default-thumb-5ch.svg");
  });

  it("同じslugなら常に同じsrcになる（決定論）", () => {
    const slug = "reaction-article-slug-2";
    const html1 = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="海外の反応" slug={slug} />,
    );
    const html2 = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="海外の反応" slug={slug} />,
    );
    expect(html1).toBe(html2);
  });

  it("thumbnailUrl=null + 非反応カテゴリ(パッチ/メタ) + slug指定 → 従来どおりカテゴリSVG", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail thumbnailUrl={null} category="パッチ/メタ" slug="some-slug" />,
    );
    expect(html).toContain('src="/default-thumb-patch-meta.svg"');
  });

  it("thumbnailUrl=有効なURL + 反応カテゴリ → 保存済みthumbnailUrlを優先する（回帰なし）", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail
        thumbnailUrl="https://example.com/saved.jpg"
        category="5chの反応"
        slug="some-slug"
      />,
    );
    expect(html).toContain('src="https://example.com/saved.jpg"');
  });

  it("thumbnailUrl=null + 反応カテゴリ + slug未指定 → 安全側でカテゴリSVGにフォールバックする", () => {
    const html = renderToStaticMarkup(<ArticleThumbnail thumbnailUrl={null} category="5chの反応" />);
    expect(html).toContain('src="/default-thumb-5ch.svg"');
  });
});
