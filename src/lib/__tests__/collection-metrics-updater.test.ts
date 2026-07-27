/**
 * リファクタリングS4（F-S4-3）: updateDueMetrics の結合テスト（ブリーフ テスト3）。
 * 専用テストDB（vitest.global-setup.ts でDATABASE_URLを差し替え済み）に対して実際にPrisma経由で
 * 書き込み、「dueのみ追記＋lastCheckedAt更新」「48h超はretired」「maxPostsPerRunの上限」
 * 「1件失敗でも継続・例外なし」「sleep注入によるディレイ」を検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateDueMetrics } from "@/lib/collection/metrics-updater";
import type { MetricsScheduleConfig } from "@/lib/collection/metrics-schedule";
import type { SourceAdapter } from "@/lib/collection/types";

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

const CONFIG: MetricsScheduleConfig = {
  earlyIntervalMinutes: 10,
  earlyPhaseHours: 1,
  midIntervalMinutes: 30,
  midPhaseHours: 6,
  lateIntervalMinutes: 120,
  latePhaseHours: 24,
  tailIntervalMinutes: 360,
  maxMonitorHours: 48,
  maxPostsPerRun: 50,
};

type CreatePostOptions = {
  sourceType?: string;
  externalId: string;
  postedAt: Date;
  lastCheckedAt: Date | null;
  monitoring?: boolean;
};

async function createPost(opts: CreatePostOptions) {
  return prisma.post.create({
    data: {
      sourceType: opts.sourceType ?? "reddit",
      externalId: opts.externalId,
      title: "タイトル",
      body: "本文",
      url: `https://example.com/${opts.externalId}`,
      postedAt: opts.postedAt,
      lastCheckedAt: opts.lastCheckedAt,
      monitoring: opts.monitoring ?? true,
    },
  });
}

function fakeAdapter(
  sourceType: "reddit" | "5ch",
  fetchMetrics: SourceAdapter["fetchMetrics"],
): SourceAdapter {
  return {
    sourceType,
    fetchItems: async () => [],
    fetchMetrics,
  };
}

describe("updateDueMetrics（リファクタリングS4 F-S4-3）", () => {
  it("monitoring=trueのdueなPostのみPostMetricsHistoryに追記し、lastCheckedAtを更新する", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    // ageHours=2(mid帯・30分間隔)。lastCheckedAtが1時間前なのでdue。
    const duePost = await createPost({
      externalId: "due-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    // ageHours=2。lastCheckedAtが5分前なのでdueではない(mid帯30分未満)。
    const notDuePost = await createPost({
      externalId: "not-due-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:55:00.000Z"),
    });

    const fetchMetrics = vi.fn(async () => ({ score: 100, commentCount: 20 }));
    const result = await updateDueMetrics({
      now,
      adapters: { reddit: fakeAdapter("reddit", fetchMetrics) },
      scheduleConfig: CONFIG,
      sleep: async () => {},
    });

    expect(result).toEqual({ checked: 2, updated: 1, retired: 0 });
    expect(fetchMetrics).toHaveBeenCalledTimes(1);
    expect(fetchMetrics).toHaveBeenCalledWith("due-1");

    const history = await prisma.postMetricsHistory.findMany({ where: { postId: duePost.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ score: 100, commentCount: 20 });
    expect(history[0].capturedAt).toEqual(now);

    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: duePost.id } });
    expect(updatedPost.lastCheckedAt).toEqual(now);
    expect(updatedPost.monitoring).toBe(true);

    const untouchedPost = await prisma.post.findUniqueOrThrow({ where: { id: notDuePost.id } });
    expect(untouchedPost.lastCheckedAt).toEqual(new Date("2026-07-27T01:55:00.000Z"));

    const noHistoryForNotDue = await prisma.postMetricsHistory.findMany({ where: { postId: notDuePost.id } });
    expect(noHistoryForNotDue).toHaveLength(0);
  });

  it("fetchMetricsがnullを返した場合はlastCheckedAtのみ更新し履歴は追記しない", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    const post = await createPost({
      externalId: "null-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
    });

    const result = await updateDueMetrics({
      now,
      adapters: { reddit: fakeAdapter("reddit", async () => null) },
      scheduleConfig: CONFIG,
      sleep: async () => {},
    });

    expect(result).toEqual({ checked: 1, updated: 0, retired: 0 });
    const history = await prisma.postMetricsHistory.findMany({ where: { postId: post.id } });
    expect(history).toHaveLength(0);
    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(updatedPost.lastCheckedAt).toEqual(now);
  });

  it("ageHours > maxMonitorHoursのPostはmonitoring=falseになり監視終了する(retired)", async () => {
    const now = new Date("2026-07-29T01:00:00.000Z"); // postedAtから49時間経過(>48h)
    const post = await createPost({
      externalId: "expired-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-28T00:00:00.000Z"),
    });

    const fetchMetrics = vi.fn(async () => ({ score: 1, commentCount: 1 }));
    const result = await updateDueMetrics({
      now,
      adapters: { reddit: fakeAdapter("reddit", fetchMetrics) },
      scheduleConfig: CONFIG,
      sleep: async () => {},
    });

    expect(result).toEqual({ checked: 1, updated: 0, retired: 1 });
    expect(fetchMetrics).not.toHaveBeenCalled();
    const retiredPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(retiredPost.monitoring).toBe(false);
  });

  it("monitoring=falseのPostは対象にならない", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    await createPost({
      externalId: "retired-already",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
      monitoring: false,
    });

    const result = await updateDueMetrics({ now, adapters: {}, scheduleConfig: CONFIG, sleep: async () => {} });
    expect(result).toEqual({ checked: 0, updated: 0, retired: 0 });
  });

  it("maxPostsPerRunで1回の実行の更新件数が上限になる", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      await createPost({
        externalId: `many-${i}`,
        postedAt: new Date("2026-07-27T00:00:00.000Z"),
        lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
      });
    }

    const fetchMetrics = vi.fn(async () => ({ score: 1, commentCount: 1 }));
    const result = await updateDueMetrics({
      now,
      adapters: { reddit: fakeAdapter("reddit", fetchMetrics) },
      scheduleConfig: { ...CONFIG, maxPostsPerRun: 2 },
      sleep: async () => {},
    });

    expect(result.checked).toBe(2);
    expect(result.updated).toBe(2);
    expect(fetchMetrics).toHaveBeenCalledTimes(2);
  });

  it("fetchMetrics未対応のアダプタ(sourceType該当なし)はlastCheckedAtのみ更新する", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    const post = await createPost({
      sourceType: "riot",
      externalId: "riot-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
    });

    const result = await updateDueMetrics({ now, adapters: {}, scheduleConfig: CONFIG, sleep: async () => {} });
    expect(result).toEqual({ checked: 1, updated: 0, retired: 0 });
    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(updatedPost.lastCheckedAt).toEqual(now);
  });

  it("1件のfetchMetrics失敗(例外)があっても他のPostは継続処理され、全体としても例外を投げない", async () => {
    const errorLogSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const now = new Date("2026-07-27T02:00:00.000Z");
    const failPost = await createPost({
      externalId: "fail-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    const okPost = await createPost({
      externalId: "ok-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
    });

    const fetchMetrics = vi.fn(async (externalId: string) => {
      if (externalId === "fail-1") throw new Error("意図的な失敗(テスト用)");
      return { score: 5, commentCount: 5 };
    });

    await expect(
      updateDueMetrics({
        now,
        adapters: { reddit: fakeAdapter("reddit", fetchMetrics) },
        scheduleConfig: CONFIG,
        sleep: async () => {},
      }),
    ).resolves.toEqual({ checked: 2, updated: 1, retired: 0 });
    expect(errorLogSpy).toHaveBeenCalled();

    const okHistory = await prisma.postMetricsHistory.findMany({ where: { postId: okPost.id } });
    expect(okHistory).toHaveLength(1);
    const failHistory = await prisma.postMetricsHistory.findMany({ where: { postId: failPost.id } });
    expect(failHistory).toHaveLength(0);
  });

  it("連続fetch間でsleepが呼ばれる(delayMs:0+noop注入で実待機なし)", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    for (let i = 0; i < 3; i++) {
      await createPost({
        externalId: `sleep-${i}`,
        postedAt: new Date("2026-07-27T00:00:00.000Z"),
        lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
      });
    }
    const sleepMock = vi.fn(async () => {});
    const fetchMetrics = vi.fn(async () => ({ score: 1, commentCount: 1 }));

    await updateDueMetrics({
      now,
      adapters: { reddit: fakeAdapter("reddit", fetchMetrics) },
      scheduleConfig: CONFIG,
      delayMs: 0,
      sleep: sleepMock,
    });

    // 3件fetchのうち最初はディレイ無し、以降2回sleepが呼ばれる。
    expect(sleepMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(0);
  });

  it("adapters省略時は例外を投げない(getAllAdapters()から構築、mockモード既定)", async () => {
    const now = new Date("2026-07-27T02:00:00.000Z");
    await createPost({
      externalId: "default-adapter-1",
      postedAt: new Date("2026-07-27T00:00:00.000Z"),
      lastCheckedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    await expect(updateDueMetrics({ now, scheduleConfig: CONFIG, sleep: async () => {} })).resolves.toBeDefined();
  });
});
