/**
 * 拡張E50 F-E50-2のテスト。記事ページ（/articles/[slug]）の本文直前に、記事のサムネイル画像を
 * ヒーローとして表示するかどうかの判定（`shouldShowHeroThumbnail`）と、その際に実際に描画される
 * ヒーロー画像（`ArticleThumbnail`）のsrcを検証する。
 *
 * ページ本体（articles/[slug]/page.tsx）はasync Server Component（`PageWithSidebar`等の
 * 非同期子コンポーネントを含む）で、react-dom/serverの同期APIでは直接レンダリングできないため、
 * 分岐判定ロジック（shouldShowHeroThumbnail）と実際に使われる描画コンポーネント（ArticleThumbnail）
 * を単体でテストする方針とする。
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PATCH_PREVIEW_BADGE_TEXT, shouldShowHeroThumbnail } from "@/lib/article-body";
import { ArticleThumbnail } from "@/components/article-thumbnail";
import { pickDeterministicChampionSplashUrl } from "@/lib/generation/champion-splash";
import type { ArticleBodyBlock } from "@/lib/article-body";

const nonImageBody: ArticleBodyBlock[] = [
  { type: "heading", text: "見出し" },
  { type: "paragraph", text: "テスト用の本文段落です。" },
];

const imageFirstBody: ArticleBodyBlock[] = [
  { type: "image", url: "https://example.com/patch-banner.jpg", alt: "パッチバナー" },
  { type: "heading", text: "パッチ見出し" },
];

/** パッチ記事刷新S5 F-S5-2: 速報バッジ段落＋バナー画像のpreview記事本文。 */
const previewBadgeThenImageBody: ArticleBodyBlock[] = [
  { type: "paragraph", text: PATCH_PREVIEW_BADGE_TEXT },
  { type: "image", url: "https://example.com/patch-banner.jpg", alt: "パッチバナー" },
  { type: "heading", text: "パッチ見出し" },
];

describe("shouldShowHeroThumbnail（拡張E50 F-E50-2）", () => {
  it("本文先頭がimageブロックでない記事はtrue(ヒーローを表示する)を返す", () => {
    expect(shouldShowHeroThumbnail(nonImageBody)).toBe(true);
  });

  it("本文先頭がimageブロックの記事(パッチのバナー)はfalse(ヒーローを表示しない=二重画像防止)を返す", () => {
    expect(shouldShowHeroThumbnail(imageFirstBody)).toBe(false);
  });

  it("本文が空配列でも例外を投げずtrueを返す", () => {
    expect(shouldShowHeroThumbnail([])).toBe(true);
  });

  it("速報バッジ段落の次がimageブロックの記事(preview記事のバナー)はfalse(ヒーローを表示しない=二重画像防止、パッチ記事刷新S5 F-S5-2)を返す", () => {
    expect(shouldShowHeroThumbnail(previewBadgeThenImageBody)).toBe(false);
  });
});

describe("記事ページのヒーロー画像に使われるArticleThumbnailのsrc（拡張E50 F-E50-2 テスト3）", () => {
  it("反応記事(thumbnailUrl未設定)はslugから決定論的に選んだチャンピオンスプラッシュがsrcになる", () => {
    const slug = "hero-test-reaction-article";
    const html = renderToStaticMarkup(
      <ArticleThumbnail
        thumbnailUrl={null}
        category="5chの反応"
        slug={slug}
        alt="反応記事のヒーローテスト"
        className="max-h-96 w-full rounded-lg object-cover"
      />,
    );
    const expectedSrc = pickDeterministicChampionSplashUrl(slug);
    expect(html).toContain(`src="${expectedSrc}"`);
    expect(html).toContain('alt="反応記事のヒーローテスト"');
  });

  it("保存済みthumbnailUrlがある記事はそのURLがsrcになる", () => {
    const html = renderToStaticMarkup(
      <ArticleThumbnail
        thumbnailUrl="https://example.com/saved-thumb.jpg"
        category="パッチ/メタ"
        slug="hero-test-saved-thumb-article"
        alt="保存済みサムネのヒーローテスト"
        className="max-h-96 w-full rounded-lg object-cover"
      />,
    );
    expect(html).toContain('src="https://example.com/saved-thumb.jpg"');
  });
});
