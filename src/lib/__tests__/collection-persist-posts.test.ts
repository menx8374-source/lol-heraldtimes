/**
 * リファクタリングS2（F-S2-2）: persistPosts の結合テスト。専用テストDB（vitest.global-setup.ts で
 * DATABASE_URL を差し替え済み）に対して実際にPrisma経由で書き込み、
 * 「upsert（Postは1行・メトリクスは時系列で複数行）」「externalId無し無視」「1件失敗のグレースフル継続」を検証する。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { persistPosts } from "@/lib/collection/persist-posts";
import type { RawCollectionItem } from "@/lib/collection/types";

async function resetDb() {
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function item(overrides: Partial<RawCollectionItem> = {}): RawCollectionItem {
  return {
    title: "タイトル",
    content: "本文",
    sourceUrl: "https://example.com/post-1",
    fetchedAt: new Date("2026-07-25T00:00:00+09:00"),
    externalId: "post-1",
    score: 10,
    commentCount: 2,
    ...overrides,
  };
}

describe("persistPosts（リファクタリングS2 F-S2-2）", () => {
  it("externalIdありのアイテムはPostがupsertされ、PostMetricsHistoryが1行追記される", async () => {
    const now = new Date("2026-07-25T10:00:00+09:00");
    const result = await persistPosts(
      [item({ externalId: "abc", author: "user1", flair: "Discussion", media: { imageUrl: "https://x/y.png" } })],
      "reddit",
      now,
    );

    expect(result.postCount).toBe(1);
    expect(result.metricsCount).toBe(1);

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "abc" } },
    });
    expect(post.title).toBe("タイトル");
    expect(post.body).toBe("本文");
    expect(post.url).toBe("https://example.com/post-1");
    expect(post.author).toBe("user1");
    expect(post.flair).toBe("Discussion");
    expect(post.media).toEqual({ imageUrl: "https://x/y.png" });
    expect(post.monitoring).toBe(true);
    expect(post.lastCheckedAt).toEqual(now);

    const metrics = await prisma.postMetricsHistory.findMany({ where: { postId: post.id } });
    expect(metrics).toHaveLength(1);
    expect(metrics[0].score).toBe(10);
    expect(metrics[0].commentCount).toBe(2);
  });

  it("同一externalIdを2回persistするとPostは1行のまま(update)で、PostMetricsHistoryは2行(時系列)になる", async () => {
    const t1 = new Date("2026-07-25T10:00:00+09:00");
    const t2 = new Date("2026-07-25T11:00:00+09:00");

    await persistPosts([item({ externalId: "dup-1", score: 10, commentCount: 2 })], "reddit", t1);
    await persistPosts(
      [item({ externalId: "dup-1", title: "更新後タイトル", score: 50, commentCount: 8 })],
      "reddit",
      t2,
    );

    const posts = await prisma.post.findMany({ where: { sourceType: "reddit", externalId: "dup-1" } });
    expect(posts).toHaveLength(1);
    expect(posts[0].title).toBe("更新後タイトル");
    expect(posts[0].lastCheckedAt).toEqual(t2);
    expect(posts[0].firstSeenAt).not.toEqual(t2); // firstSeenAtは初回のまま保持される

    const history = await prisma.postMetricsHistory.findMany({
      where: { postId: posts[0].id },
      orderBy: { capturedAt: "asc" },
    });
    expect(history.map((h) => h.score)).toEqual([10, 50]);
    expect(history.map((h) => h.commentCount)).toEqual([2, 8]);
  });

  it("externalId無しのアイテムは無視される(Post未作成)", async () => {
    const result = await persistPosts([item({ externalId: undefined, sourceUrl: "https://example.com/no-id" })], "5ch", new Date());

    expect(result.postCount).toBe(0);
    expect(result.metricsCount).toBe(0);
    const count = await prisma.post.count();
    expect(count).toBe(0);
  });

  it("1件の保存が失敗しても例外を投げず、他アイテムは保存される(グレースフル)", async () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const upsertSpy = vi
      .spyOn(prisma.post, "upsert")
      .mockRejectedValueOnce(new Error("意図的な失敗(テスト用)"));

    const items = [
      item({ externalId: "fail-1", sourceUrl: "https://example.com/fail-1" }),
      item({ externalId: "ok-1", sourceUrl: "https://example.com/ok-1" }),
    ];

    await expect(persistPosts(items, "reddit", new Date())).resolves.toEqual({
      postCount: 1,
      metricsCount: 1,
    });
    expect(errorLogSpy).toHaveBeenCalled();

    const okPost = await prisma.post.findUnique({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "ok-1" } },
    });
    expect(okPost).not.toBeNull();
    const failPost = await prisma.post.findUnique({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "fail-1" } },
    });
    expect(failPost).toBeNull();

    upsertSpy.mockRestore();
  });

  it("item.mediaが無くitem.imageUrlのみ持つ場合、Post.media.imageUrlにフォールバック保存される(riot相当、リファクタリングS5c F-S5c-2)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts(
      [item({ externalId: "patch-26-14", media: undefined, imageUrl: "https://www.leagueoflegends.com/og-image.png" })],
      "riot",
      now,
    );

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "riot", externalId: "patch-26-14" } },
    });
    expect(post.media).toEqual({ imageUrl: "https://www.leagueoflegends.com/og-image.png" });
  });

  it("item.mediaが有る場合はitem.imageUrlより優先される(従来どおり)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts(
      [
        item({
          externalId: "media-priority",
          media: { imageUrl: "https://example.com/from-media.png" },
          imageUrl: "https://example.com/from-image-url.png",
        }),
      ],
      "reddit",
      now,
    );

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "media-priority" } },
    });
    expect(post.media).toEqual({ imageUrl: "https://example.com/from-media.png" });
  });

  it("item.media・item.imageUrlとも無い場合はPost.mediaがnullのまま保存される(回帰なし)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts([item({ externalId: "no-media", media: undefined, imageUrl: undefined })], "5ch", now);

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "5ch", externalId: "no-media" } },
    });
    expect(post.media).toBeNull();
  });

  it("item.categoryが指定されていればPost.categoryに保存される(リファクタリングS7a F-S7a-3)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts(
      [item({ externalId: "riot-news-1", category: "Riot公式" })],
      "riot",
      now,
    );

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "riot", externalId: "riot-news-1" } },
    });
    expect(post.category).toBe("Riot公式");
  });

  it("item.categoryが未指定ならPost.categoryはnullのまま保存される(回帰なし)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts([item({ externalId: "no-category" })], "reddit", now);

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "no-category" } },
    });
    expect(post.category).toBeNull();
  });

  it("item.upvoteRatioが指定されていればPost.upvoteRatioに保存される(成長G1 F-G1-3)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts([item({ externalId: "upvote-1", upvoteRatio: 0.55 })], "reddit", now);

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "upvote-1" } },
    });
    expect(post.upvoteRatio).toBeCloseTo(0.55, 5);
  });

  it("item.upvoteRatioが未指定ならPost.upvoteRatioはnullのまま保存される(回帰なし)", async () => {
    const now = new Date("2026-07-27T10:00:00+09:00");
    await persistPosts([item({ externalId: "no-upvote-ratio" })], "reddit", now);

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "no-upvote-ratio" } },
    });
    expect(post.upvoteRatio).toBeNull();
  });

  it("同一externalIdを再persistするとPost.upvoteRatioが更新される(update時も反映)", async () => {
    const t1 = new Date("2026-07-27T10:00:00+09:00");
    const t2 = new Date("2026-07-27T11:00:00+09:00");
    await persistPosts([item({ externalId: "upvote-update", upvoteRatio: 0.9 })], "reddit", t1);
    await persistPosts([item({ externalId: "upvote-update", upvoteRatio: 0.4 })], "reddit", t2);

    const post = await prisma.post.findUniqueOrThrow({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "upvote-update" } },
    });
    expect(post.upvoteRatio).toBeCloseTo(0.4, 5);
  });
});
