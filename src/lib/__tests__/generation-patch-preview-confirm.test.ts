/**
 * confirmPatchPreviewArticles（パッチ記事刷新S5 F-S5-3）の結合テスト。
 * 専用テストDB（vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で
 * 書き込み、「PATCH_PREVIEW_MODE無効(既定)ではDBに触れずno-op」「本番反映後(Post.mediaのpatchPreview
 * フラグが外れた)preview記事のみ確定版へin-place更新(slug/id/postId/publishedAt不変・重複記事なし)・
 * ArticleUpdateHistory追記」「まだpreviewのまま(Post側未反映)は何もしない」「既に確定済み記事はスキップ」
 * を検証する。
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { confirmPatchPreviewArticles } from "@/lib/generation/patch-preview-confirm";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { parseArticleBody } from "@/lib/article-body";
import { isPatchPreviewArticleBody } from "@/lib/generation/compose";

async function resetDb() {
  await prisma.articleUpdateHistory.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

beforeEach(async () => {
  await resetDb();
  process.env.PATCH_ARTICLE_MODE = "fact"; // LLM非依存・決定論の最小構成で本体部分を固定する。
  delete process.env.PATCH_PREVIEW_MODE;
});

afterEach(() => {
  delete process.env.PATCH_ARTICLE_MODE;
  delete process.env.PATCH_PREVIEW_MODE;
});

const llm = new MockLLMClient();
const T0 = new Date("2026-07-29T12:00:00.000Z");

/** preview記事(バッジ付き)＋そのPostを1組作るヘルパ。postMediaでPost側の現在状態(preview/確定)を指定する。 */
async function setupPreviewArticle(opts: { externalId: string; postMedia: Record<string, unknown> | null }) {
  const previewTitle = `【速報】【パッチ】${opts.externalId} のゲームデータが公開`;
  const post = await prisma.post.create({
    data: {
      sourceType: "riot",
      externalId: opts.externalId,
      title: previewTitle,
      body: "短い本文",
      url: `https://www.leagueoflegends.com/ja-jp/news/game-updates/league-of-legends-patch-${opts.externalId.replace(".", "-")}-notes`,
      postedAt: T0,
      ...(opts.postMedia ? { media: opts.postMedia as Prisma.InputJsonValue } : {}),
    },
  });
  const article = await prisma.article.create({
    data: {
      slug: `slug-${opts.externalId}`,
      title: previewTitle,
      category: "パッチ/メタ",
      body: [
        { type: "paragraph", text: "【速報・未適用】このパッチはまだ本番環境に適用されていません。適用後に内容が変更される場合があります（公式パッチノートページの内容に基づく先行速報）。" },
        { type: "heading", text: `パッチ${opts.externalId}が公開` },
        { type: "paragraph", text: "リーグ・オブ・レジェンドの新しいパッチについてのダミー本文。" },
      ],
      publishedAt: T0,
      postId: post.id,
    },
  });
  return { post, article };
}

describe("confirmPatchPreviewArticles（パッチ記事刷新S5 F-S5-3）", () => {
  it("PATCH_PREVIEW_MODE未設定(既定off)では即座にno-opで返り、DBに一切アクセスしない(回帰ゼロ)", async () => {
    await setupPreviewArticle({ externalId: "26.15", postMedia: null }); // Post側は既に確定済み(patchPreview無し)
    delete process.env.PATCH_PREVIEW_MODE;

    const result = await confirmPatchPreviewArticles({ now: T0, llmClient: llm });
    expect(result).toEqual({ checked: 0, confirmed: 0, skipped: 0 });

    // 記事本文は更新されず速報バッジが残ったまま(何も変更されていない)。
    const article = await prisma.article.findFirst({ where: { slug: "slug-26.15" } });
    const body = parseArticleBody(article!.body);
    expect(isPatchPreviewArticleBody(body)).toBe(true);
  });

  it("本番反映済み(Post.media.patchPreviewフラグ無し)のpreview記事は確定版へin-place更新され、速報バッジが外れる(重複記事なし・ArticleUpdateHistory追記)", async () => {
    process.env.PATCH_PREVIEW_MODE = "on";
    const { post, article } = await setupPreviewArticle({ externalId: "26.15", postMedia: null });

    const result = await confirmPatchPreviewArticles({ now: T0, llmClient: llm });
    expect(result).toEqual({ checked: 1, confirmed: 1, skipped: 0 });

    const articlesForPost = await prisma.article.findMany({ where: { postId: post.id } });
    expect(articlesForPost).toHaveLength(1); // 重複記事が作られていない

    const updated = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(updated.id).toBe(article.id);
    expect(updated.slug).toBe(article.slug);
    expect(updated.postId).toBe(post.id);
    expect(updated.publishedAt).toEqual(article.publishedAt);

    const body = parseArticleBody(updated.body);
    expect(isPatchPreviewArticleBody(body)).toBe(false); // 速報バッジが外れている

    const history = await prisma.articleUpdateHistory.findMany({ where: { articleId: article.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ reason: "patch_preview_confirmed" });
  });

  it("Post側がまだpreviewのまま(patchPreview:true、本番未反映)のときは何もしない", async () => {
    process.env.PATCH_PREVIEW_MODE = "on";
    const { article } = await setupPreviewArticle({ externalId: "26.16", postMedia: { patchPreview: true } });

    const result = await confirmPatchPreviewArticles({ now: T0, llmClient: llm });
    expect(result).toEqual({ checked: 1, confirmed: 0, skipped: 1 });

    const untouched = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    const body = parseArticleBody(untouched.body);
    expect(isPatchPreviewArticleBody(body)).toBe(true); // 速報バッジは残ったまま
  });

  it("既に確定済み(速報バッジ無し)の記事はスキップする(二重更新しない)", async () => {
    process.env.PATCH_PREVIEW_MODE = "on";
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
    const article = await prisma.article.create({
      data: {
        slug: "slug-26.14-confirmed",
        title: "【パッチ】26.14 のゲームデータが公開",
        category: "パッチ/メタ",
        body: [{ type: "heading", text: "パッチ26.14が公開" }, { type: "paragraph", text: "確定済み本文。" }],
        publishedAt: T0,
        postId: post.id,
      },
    });

    const result = await confirmPatchPreviewArticles({ now: T0, llmClient: llm });
    expect(result).toEqual({ checked: 1, confirmed: 0, skipped: 1 });

    const history = await prisma.articleUpdateHistory.findMany({ where: { articleId: article.id } });
    expect(history).toHaveLength(0);
  });

  it("riot以外(反応記事等)のPostは対象外(sourceTypeで絞り込み済み)", async () => {
    process.env.PATCH_PREVIEW_MODE = "on";
    const post = await prisma.post.create({
      data: {
        sourceType: "reddit",
        externalId: "reddit-1",
        title: "反応記事タイトル",
        body: "1: 本文その1\n2: 本文その2",
        url: "https://example.com/reddit-1",
        postedAt: T0,
      },
    });
    await prisma.article.create({
      data: {
        slug: "slug-reddit-1",
        title: "反応記事タイトル",
        category: "海外の反応",
        body: [{ type: "reaction", number: 1, name: "海外プレイヤーさん", lines: [{ text: "本文" }] }],
        publishedAt: T0,
        postId: post.id,
      },
    });

    const result = await confirmPatchPreviewArticles({ now: T0, llmClient: llm });
    expect(result).toEqual({ checked: 0, confirmed: 0, skipped: 0 });
  });
});
