/**
 * 未適用パッチの先行速報（パッチ記事刷新S5 F-S5-2）の結合テスト。
 * Post.media.patchPreview フラグが `generateArticlesFromHotPosts` 経由で記事本文の
 * 速報バッジ付与にまで正しく伝わることを検証する（専用テストDB、実際にPrisma経由で書き込む）。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateArticlesFromHotPosts, extractPostPatchPreview } from "@/lib/generation/post-pipeline";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { parseArticleBody } from "@/lib/article-body";
import { isPatchPreviewArticleBody } from "@/lib/generation/compose";
import { CATEGORY_LABELS } from "@/lib/categories";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
  // admincms-S1: このファイルはパッチ先行速報の検証が目的のため、既定「全カテゴリ要レビュー」に
  // よる回帰を避けるべく全カテゴリを自動公開にしておく。
  await prisma.categoryPublishPolicy.deleteMany();
  await prisma.categoryPublishPolicy.createMany({
    data: CATEGORY_LABELS.map((category) => ({ category, autoPublish: true })),
  });
}

beforeEach(async () => {
  await resetDb();
  process.env.PATCH_ARTICLE_MODE = "fact"; // LLM非依存・決定論の最小構成で本体部分を固定する。
});

afterEach(() => {
  delete process.env.PATCH_ARTICLE_MODE;
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-29T12:00:00.000Z");

describe("extractPostPatchPreview（純関数）", () => {
  it("Post.mediaのpatchPreview===trueのときのみtrueを返す", () => {
    expect(extractPostPatchPreview({ patchPreview: true })).toBe(true);
    expect(extractPostPatchPreview({ patchPreview: false })).toBe(false);
    expect(extractPostPatchPreview({})).toBe(false);
    expect(extractPostPatchPreview(null)).toBe(false);
    expect(extractPostPatchPreview("not-an-object" as never)).toBe(false);
  });
});

describe("generateArticlesFromHotPosts（riot、Post.media.patchPreviewフラグ→記事本文の速報バッジ、パッチ記事刷新S5 F-S5-2）", () => {
  it("patchPreview:trueのPostは、生成される記事本文の先頭に速報バッジが付く", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "riot",
        externalId: "26.15",
        title: "【速報】【パッチ】26.15 のゲームデータが公開",
        body: "短い本文",
        url: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-15-notes",
        postedAt: T0,
        media: { patchPreview: true },
      },
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0 });
    expect(summary.succeededCount).toBe(1);

    const article = await prisma.article.findUniqueOrThrow({ where: { postId: post.id } });
    const body = parseArticleBody(article.body);
    expect(isPatchPreviewArticleBody(body)).toBe(true);
    expect(article.title).toBe("【速報】【パッチ】26.15 のゲームデータが公開");
  });

  it("patchPreviewフラグが無いPost(通常の確定パッチ)は速報バッジが付かない(回帰ゼロ)", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "riot",
        externalId: "26.14",
        title: "【パッチ】26.14 のゲームデータが公開",
        body: "短い本文",
        url: "https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-26-14-notes",
        postedAt: T0,
      },
    });

    const summary = await generateArticlesFromHotPosts(llm, { now: T0 });
    expect(summary.succeededCount).toBe(1);

    const article = await prisma.article.findUniqueOrThrow({ where: { postId: post.id } });
    const body = parseArticleBody(article.body);
    expect(isPatchPreviewArticleBody(body)).toBe(false);
  });
});
