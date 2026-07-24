import { describe, expect, it } from "vitest";
import { collectFromSource, toCollectionItems } from "@/lib/collection/collect-source";
import type { RawCollectionItem, SourceAdapter, SourceConfig } from "@/lib/collection/types";

function fakeAdapter(sourceType: SourceAdapter["sourceType"], items: RawCollectionItem[]): SourceAdapter {
  return { sourceType, fetchItems: async () => items };
}

function failingAdapter(sourceType: SourceAdapter["sourceType"], message: string): SourceAdapter {
  return {
    sourceType,
    fetchItems: async () => {
      throw new Error(message);
    },
  };
}

const baseConfig: SourceConfig = {
  sourceType: "reddit",
  rateLimit: { maxItemsPerRun: 10, minIntervalMsBetweenRuns: 10 * 60 * 1000 },
  relevance: { allowedSubreddits: ["leagueoflegends"], keywords: ["patch", "jungle"] },
};

describe("toCollectionItems", () => {
  it("出典URLが無い(または空)アイテムは共通フォーマットに変換されない", () => {
    const raw: RawCollectionItem[] = [
      { sourceUrl: "https://example.com/a", title: "t1", content: "c1", fetchedAt: new Date() },
      { sourceUrl: "", title: "t2", content: "c2", fetchedAt: new Date() },
      { sourceUrl: null, title: "t3", content: "c3", fetchedAt: new Date() },
      { title: "t4", content: "c4", fetchedAt: new Date() },
    ];
    const result = toCollectionItems("reddit", raw);
    expect(result).toHaveLength(1);
    expect(result[0].sourceUrl).toBe("https://example.com/a");
  });
});

describe("collectFromSource", () => {
  it("ソース種別・元URL・原題・本文・取得日時を持つ共通フォーマットで収集アイテムを返す", async () => {
    const fetchedAt = new Date("2026-07-24T10:00:00Z");
    const adapter = fakeAdapter("reddit", [
      { sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/1/x/", title: "Patch 14.6 jungle nerf", content: "body", fetchedAt },
    ]);
    const result = await collectFromSource(adapter, baseConfig, new Date("2026-07-24T11:00:00Z"), null);
    expect(result.status).toBe("success");
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.items).toEqual([
      { sourceType: "reddit", sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/1/x/", title: "Patch 14.6 jungle nerf", content: "body", fetchedAt },
    ]);
  });

  it("LoL関連フィルタに合致しないアイテム(別ゲーム・許可外サブレディット)は含まれない", async () => {
    const adapter = fakeAdapter("reddit", [
      { sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/1/x/", title: "Patch 14.6 jungle nerf", content: "body", fetchedAt: new Date() },
      { sourceUrl: "https://www.reddit.com/r/randomothergame/comments/2/y/", title: "Unrelated other game post", content: "body", fetchedAt: new Date() },
    ]);
    const result = await collectFromSource(adapter, baseConfig, new Date(), null);
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe("Patch 14.6 jungle nerf");
  });

  it("取得件数上限(maxItemsPerRun)を超える分は取得しない", async () => {
    const many: RawCollectionItem[] = Array.from({ length: 20 }, (_, i) => ({
      sourceUrl: `https://www.reddit.com/r/leagueoflegends/comments/${i}/x/`,
      title: "Patch 14.6 jungle nerf",
      content: "body",
      fetchedAt: new Date(),
    }));
    const adapter = fakeAdapter("reddit", many);
    const config: SourceConfig = { ...baseConfig, rateLimit: { ...baseConfig.rateLimit, maxItemsPerRun: 3 } };
    const result = await collectFromSource(adapter, config, new Date(), null);
    if (result.status !== "success") throw new Error("unreachable");
    expect(result.items).toHaveLength(3);
  });

  it("実行間隔(レート制限)内の再実行はスキップする", async () => {
    const adapter = fakeAdapter("reddit", [
      { sourceUrl: "https://www.reddit.com/r/leagueoflegends/comments/1/x/", title: "Patch 14.6 jungle nerf", content: "body", fetchedAt: new Date() },
    ]);
    const lastRunAt = new Date("2026-07-24T10:00:00Z");
    const now = new Date("2026-07-24T10:05:00Z"); // 5分後(最小間隔10分未満)
    const result = await collectFromSource(adapter, baseConfig, now, lastRunAt);
    expect(result.status).toBe("skipped-rate-limited");
    expect(result.items).toHaveLength(0);
  });

  it("取得に失敗しても例外を投げず、failure結果を返す(他ソース収集を止めない)", async () => {
    const adapter = failingAdapter("riot", "network timeout");
    const config: SourceConfig = { ...baseConfig, sourceType: "riot" };
    const result = await collectFromSource(adapter, config, new Date(), null);
    expect(result.status).toBe("failure");
    if (result.status !== "failure") throw new Error("unreachable");
    expect(result.errorMessage).toContain("network timeout");
  });

  it("1ソースが失敗しても他ソースの収集は完走する", async () => {
    const ok = fakeAdapter("5ch", [
      { sourceUrl: "https://leagueoflegends.5ch.net/test/read.cgi/game/1/", title: "パッチの話", content: "jungle patch", fetchedAt: new Date() },
    ]);
    const bad = failingAdapter("riot", "boom");

    const results = await Promise.all([
      collectFromSource(ok, { ...baseConfig, sourceType: "5ch", relevance: { keywords: ["パッチ"] } }, new Date(), null),
      collectFromSource(bad, { ...baseConfig, sourceType: "riot" }, new Date(), null),
    ]);

    expect(results[0].status).toBe("success");
    expect(results[1].status).toBe("failure");
  });
});
