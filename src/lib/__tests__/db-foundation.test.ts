/**
 * リファクタリング S1（DB基盤）の結合テスト。専用テストDB（vitest.global-setup.ts で
 * DATABASE_URL を差し替え済み）に対し、新設した Post / PostMetricsHistory / ArticleUpdateHistory と
 * Article の新SEO列・postId 関連を検証する。この段階では収集/生成/公開パイプラインには一切
 * 結線していないため、ここでは Prisma クライアント経由のスキーマ検証のみを行う。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";

async function resetDb() {
  await prisma.articleUpdateHistory.deleteMany();
  await prisma.postMetricsHistory.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.article.deleteMany();
  await prisma.post.deleteMany();
  await prisma.tag.deleteMany();
}

function articleData(overrides: Partial<Parameters<typeof prisma.article.create>[0]["data"]> = {}) {
  return {
    slug: "db-foundation-article",
    title: "DB基盤テスト記事",
    category: "パッチ/メタ",
    body: [{ type: "paragraph", text: "本文" }],
    publishedAt: new Date("2026-07-20T00:00:00+09:00"),
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDb();
});

describe("Post（F-S1-1）", () => {
  it("全フィールドを作成・取得でき、media(JSON)が往復する", async () => {
    const media = { images: ["https://example.com/a.png"], video: null };
    const post = await prisma.post.create({
      data: {
        sourceType: "reddit",
        externalId: "abc123",
        title: "投稿タイトル",
        body: "投稿本文",
        url: "https://reddit.com/r/leagueoflegends/abc123",
        author: "some_user",
        flair: "Discussion",
        media,
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });

    expect(post.monitoring).toBe(true);
    expect(post.firstSeenAt).toBeInstanceOf(Date);
    expect(post.lastCheckedAt).toBeNull();

    const found = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(found.media).toEqual(media);
    expect(found.author).toBe("some_user");
    expect(found.flair).toBe("Discussion");
  });

  it("@@unique([sourceType, externalId]) の重複作成は失敗する", async () => {
    await prisma.post.create({
      data: {
        sourceType: "5ch",
        externalId: "thread-1",
        title: "スレタイ",
        body: "本文",
        url: "https://example.com/thread-1",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });

    await expect(
      prisma.post.create({
        data: {
          sourceType: "5ch",
          externalId: "thread-1",
          title: "別タイトル",
          body: "別本文",
          url: "https://example.com/thread-1-dup",
          postedAt: new Date("2026-07-20T00:00:00+09:00"),
        },
      }),
    ).rejects.toThrow();
  });

  it("同じexternalIdでもsourceTypeが異なれば作成できる", async () => {
    await prisma.post.create({
      data: {
        sourceType: "reddit",
        externalId: "shared-id",
        title: "reddit投稿",
        body: "本文",
        url: "https://example.com/r/shared-id",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });
    const other = await prisma.post.create({
      data: {
        sourceType: "5ch",
        externalId: "shared-id",
        title: "5ch投稿",
        body: "本文",
        url: "https://example.com/5ch/shared-id",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });
    expect(other.id).toBeTruthy();
  });
});

describe("PostMetricsHistory（F-S1-2）", () => {
  it("同一Postに複数追記でき、postId・capturedAt の時系列で取得できる", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "reddit",
        externalId: "metrics-1",
        title: "メトリクス対象",
        body: "本文",
        url: "https://example.com/metrics-1",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });

    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: 10, commentCount: 2, capturedAt: new Date("2026-07-19T01:00:00+09:00") },
    });
    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: 50, commentCount: 8, capturedAt: new Date("2026-07-19T02:00:00+09:00") },
    });

    const history = await prisma.postMetricsHistory.findMany({
      where: { postId: post.id },
      orderBy: { capturedAt: "asc" },
    });
    expect(history.map((h) => h.score)).toEqual([10, 50]);
    expect(history.map((h) => h.commentCount)).toEqual([2, 8]);
  });

  it("Post削除でPostMetricsHistoryがCascade削除される", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "reddit",
        externalId: "metrics-cascade",
        title: "カスケード対象",
        body: "本文",
        url: "https://example.com/metrics-cascade",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });
    await prisma.postMetricsHistory.create({
      data: { postId: post.id, score: 1, commentCount: 0 },
    });

    await prisma.post.delete({ where: { id: post.id } });

    const remaining = await prisma.postMetricsHistory.findMany({ where: { postId: post.id } });
    expect(remaining).toHaveLength(0);
  });
});

describe("ArticleUpdateHistory（F-S1-3）", () => {
  it("作成でき、articleIdで取得できる", async () => {
    const article = await prisma.article.create({ data: articleData() });
    const history = await prisma.articleUpdateHistory.create({
      data: { articleId: article.id, reason: "score_surge", detail: "スコア急増" },
    });
    expect(history.reason).toBe("score_surge");

    const found = await prisma.articleUpdateHistory.findMany({ where: { articleId: article.id } });
    expect(found).toHaveLength(1);
  });

  it("Article削除でArticleUpdateHistoryがCascade削除される", async () => {
    const article = await prisma.article.create({ data: articleData({ slug: "history-cascade" }) });
    await prisma.articleUpdateHistory.create({ data: { articleId: article.id, reason: "hot_rank" } });

    await prisma.article.delete({ where: { id: article.id } });

    const remaining = await prisma.articleUpdateHistory.findMany({ where: { articleId: article.id } });
    expect(remaining).toHaveLength(0);
  });
});

describe("Article のSEO列・Post関連（F-S1-4）", () => {
  it("seoTitle等の新SEO列とpostIdを設定して作成・取得できる", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "riot",
        externalId: "seo-post-1",
        title: "元投稿",
        body: "本文",
        url: "https://example.com/seo-post-1",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });
    const article = await prisma.article.create({
      data: articleData({
        slug: "seo-article",
        seoTitle: "SEO用タイトル",
        metaDescription: "SEO用説明",
        ogTitle: "OGタイトル",
        ogDescription: "OG説明",
        postId: post.id,
      }),
    });

    const found = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(found.seoTitle).toBe("SEO用タイトル");
    expect(found.metaDescription).toBe("SEO用説明");
    expect(found.ogTitle).toBe("OGタイトル");
    expect(found.ogDescription).toBe("OG説明");
    expect(found.postId).toBe(post.id);
  });

  it("postId は@uniqueのため、同一Postを2記事から参照すると失敗する", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "riot",
        externalId: "seo-post-unique",
        title: "元投稿",
        body: "本文",
        url: "https://example.com/seo-post-unique",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });
    await prisma.article.create({ data: articleData({ slug: "seo-article-1", postId: post.id }) });

    await expect(
      prisma.article.create({ data: articleData({ slug: "seo-article-2", postId: post.id }) }),
    ).rejects.toThrow();
  });

  it("Post削除でArticle.postIdがSetNullされる", async () => {
    const post = await prisma.post.create({
      data: {
        sourceType: "riot",
        externalId: "seo-post-setnull",
        title: "元投稿",
        body: "本文",
        url: "https://example.com/seo-post-setnull",
        postedAt: new Date("2026-07-19T00:00:00+09:00"),
      },
    });
    const article = await prisma.article.create({
      data: articleData({ slug: "seo-article-setnull", postId: post.id }),
    });

    await prisma.post.delete({ where: { id: post.id } });

    const found = await prisma.article.findUniqueOrThrow({ where: { id: article.id } });
    expect(found.postId).toBeNull();
  });
});

describe("回帰: 新列を指定しない従来どおりのArticle作成（最重要）", () => {
  it("新列を一切指定しなくても従来どおり作成でき、新列はすべてnull", async () => {
    const article = await prisma.article.create({ data: articleData({ slug: "legacy-article" }) });

    expect(article.seoTitle).toBeNull();
    expect(article.metaDescription).toBeNull();
    expect(article.ogTitle).toBeNull();
    expect(article.ogDescription).toBeNull();
    expect(article.postId).toBeNull();
    expect(article.status).toBe("published");
  });
});
