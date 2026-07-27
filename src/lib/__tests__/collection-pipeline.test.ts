/**
 * 収集パイプラインDB連携部分（F5・リファクタリングS2 F-S2-3）の結合テスト。専用テストDB
 * （vitest.global-setup.ts で DATABASE_URL を差し替え済み）に対し、runCollectionPipeline が
 * 既存の CollectedItem/SourceFetchLog/SourceRunSummary を従来どおり保存しつつ（回帰なし）、
 * externalId を持つソースについては Post/PostMetricsHistory も並行して保存すること、
 * Post保存が失敗しても収集結果自体は success のままであることを検証する。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { runCollectionPipeline } from "@/lib/collection/pipeline";
import type { RawCollectionItem, SourceAdapter, SourceConfig, SourceType } from "@/lib/collection/types";

class FakeAdapter implements SourceAdapter {
  constructor(
    public readonly sourceType: SourceType,
    private readonly itemsOrThrow: RawCollectionItem[] | (() => RawCollectionItem[]),
  ) {}
  async fetchItems(): Promise<RawCollectionItem[]> {
    if (typeof this.itemsOrThrow === "function") return this.itemsOrThrow();
    return this.itemsOrThrow;
  }
}

function config(sourceType: SourceType, keywords: string[]): SourceConfig {
  return {
    sourceType,
    rateLimit: { maxItemsPerRun: 10, minIntervalMsBetweenRuns: 10 * 60 * 1000 },
    // reddit以外はサブレディット許可リストの概念が無い(filter.tsが無視する)ため、
    // ここでは常にキーワードのみで判定させる(allowedSubreddits未設定)。
    relevance: { keywords },
  };
}

async function resetDb() {
  await prisma.postMetricsHistory.deleteMany();
  await prisma.post.deleteMany();
  await prisma.sourceFetchLog.deleteMany();
  await prisma.collectedItem.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const T0 = new Date("2026-07-25T00:00:00+09:00");

describe("runCollectionPipeline（リファクタリングS2 F-S2-3）", () => {
  it("既存のCollectedItem保存・SourceRunSummaryは回帰せず、externalIdを持つアイテムはPostにも保存される", async () => {
    const adapters = [
      new FakeAdapter("reddit", [
        {
          sourceUrl: "https://www.reddit.com/comments/xyz/",
          title: "patch discussion jungle",
          content: "jungle patch content",
          fetchedAt: T0,
          externalId: "xyz",
          score: 55,
          commentCount: 3,
        },
      ]),
    ];
    const configs = { reddit: config("reddit", ["patch", "jungle"]) } as Record<SourceType, SourceConfig>;

    const summaries = await runCollectionPipeline(adapters, configs, T0);

    // 既存挙動(回帰なし): SourceRunSummary
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ sourceType: "reddit", status: "success", fetchedCount: 1, savedCount: 1 });

    // 既存挙動(回帰なし): CollectedItem・SourceFetchLog
    const collected = await prisma.collectedItem.findFirst({ where: { sourceUrl: "https://www.reddit.com/comments/xyz/" } });
    expect(collected).not.toBeNull();
    const log = await prisma.sourceFetchLog.findFirst({ where: { sourceType: "reddit" } });
    expect(log?.status).toBe("success");

    // 新規(S2): Post/PostMetricsHistoryが並行保存される
    const post = await prisma.post.findUnique({
      where: { sourceType_externalId: { sourceType: "reddit", externalId: "xyz" } },
    });
    expect(post).not.toBeNull();
    const metrics = await prisma.postMetricsHistory.findMany({ where: { postId: post!.id } });
    expect(metrics).toHaveLength(1);
    expect(metrics[0].score).toBe(55);
    expect(metrics[0].commentCount).toBe(3);
  });

  it("Post保存が失敗しても収集結果はsuccessのまま(本体を止めない)", async () => {
    vi.spyOn(prisma.post, "upsert").mockRejectedValue(new Error("意図的なPost保存失敗(テスト用)"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const adapters = [
      new FakeAdapter("5ch", [
        {
          sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/1/",
          title: "パッチの話",
          content: "jungle patch",
          fetchedAt: T0,
          externalId: "server/game/1",
          commentCount: 20,
          score: 0,
        },
      ]),
    ];
    const configs = { "5ch": config("5ch", ["パッチ", "jungle"]) } as Record<SourceType, SourceConfig>;

    const summaries = await runCollectionPipeline(adapters, configs, T0);

    expect(summaries[0].status).toBe("success");
    expect(summaries[0].savedCount).toBe(1);

    const collected = await prisma.collectedItem.findFirst({
      where: { sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/1/" },
    });
    expect(collected).not.toBeNull(); // 旧経路は影響を受けない

    const postCount = await prisma.post.count();
    expect(postCount).toBe(0); // Post保存自体は失敗しているため作られない
  });

  it("externalIdを持たないアイテム(mock等)はPostが作られない(回帰なし)", async () => {
    const adapters = [
      new FakeAdapter("riot", [
        {
          sourceUrl: "https://www.leagueoflegends.com/ja-jp/news/patch-no-id/",
          title: "パッチノート公開",
          content: "内容",
          fetchedAt: T0,
        },
      ]),
    ];
    const configs = { riot: config("riot", ["パッチ"]) } as Record<SourceType, SourceConfig>;

    await runCollectionPipeline(adapters, configs, T0);

    const postCount = await prisma.post.count();
    expect(postCount).toBe(0);
  });
});
