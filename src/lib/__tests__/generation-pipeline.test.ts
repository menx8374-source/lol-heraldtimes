/**
 * generateArticlesForQueue のカテゴリ(=ソース種別)別上限（拡張E48 F-E48-2）の結合テスト。
 * 専用テストDBに対して実際にPrisma経由で書き込み、maxPerCategory 指定時に各ソース独立で
 * 最大件数まで処理されること・未指定時は従来どおり総数上限(maxCandidates)で動くことを検証する。
 * 生成の成功/失敗自体は本テストの関心事ではない(処理対象になったかどうかだけを見る)ため、
 * 候補の内容は最小限にとどめる。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateArticlesForQueue } from "@/lib/generation/pipeline";
import { MockLLMClient } from "@/lib/generation/llm-client";
import { normalizeUrl } from "@/lib/collection/normalize";
import type { SourceType } from "@/lib/collection/types";

async function resetDb() {
  await prisma.articleSource.deleteMany();
  await prisma.collectedItem.deleteMany();
  await prisma.article.deleteMany();
}

beforeEach(async () => {
  await resetDb();
});

const llm = new MockLLMClient();

let seq = 0;
async function createQueuedItem(sourceType: SourceType): Promise<string> {
  seq += 1;
  const sourceUrl = `https://example.com/${sourceType}/${seq}`;
  const item = await prisma.collectedItem.create({
    data: {
      sourceType,
      sourceUrl,
      normalizedUrl: normalizeUrl(sourceUrl),
      title: `title-${seq}`,
      content: `1: content-${seq}\n2: reply-${seq}`,
      fetchedAt: new Date(Date.now() - seq * 1000),
      status: "queued",
    },
  });
  return item.id;
}

describe("generateArticlesForQueue（maxPerCategory、拡張E48）", () => {
  it("maxPerCategory:2 指定時、5ch×5・reddit×3・riot×1 の候補があっても各ソース独立に最大2件ずつ処理される", async () => {
    const fivechIds = await Promise.all(Array.from({ length: 5 }, () => createQueuedItem("5ch")));
    const redditIds = await Promise.all(Array.from({ length: 3 }, () => createQueuedItem("reddit")));
    const riotIds = await Promise.all(Array.from({ length: 1 }, () => createQueuedItem("riot")));

    const summary = await generateArticlesForQueue(llm, { maxPerCategory: 2, championMap: null });

    const processedIds = new Set(summary.results.map((r) => r.collectedItemId));
    expect(processedIds.size).toBe(5); // 2 + 2 + 1

    const processedFivech = fivechIds.filter((id) => processedIds.has(id));
    const processedReddit = redditIds.filter((id) => processedIds.has(id));
    const processedRiot = riotIds.filter((id) => processedIds.has(id));

    expect(processedFivech).toHaveLength(2);
    expect(processedReddit).toHaveLength(2);
    expect(processedRiot).toHaveLength(1); // riotが1件しかなくても他ソースの取得数に影響しない
  });

  it("maxPerCategory 未指定・maxCandidates 指定時は従来どおり総数上限で動く(後方互換)", async () => {
    await Promise.all(Array.from({ length: 3 }, () => createQueuedItem("5ch")));
    await Promise.all(Array.from({ length: 3 }, () => createQueuedItem("riot")));

    const summary = await generateArticlesForQueue(llm, { maxCandidates: 2, championMap: null });

    const processedIds = new Set(summary.results.map((r) => r.collectedItemId));
    expect(processedIds.size).toBe(2); // 総数上限2件のみ処理される(ソース内訳は問わない)
  });

  it("maxPerCategory・maxCandidates いずれも未指定時は全 queued が処理される(回帰なし)", async () => {
    await Promise.all(Array.from({ length: 2 }, () => createQueuedItem("5ch")));
    await Promise.all(Array.from({ length: 2 }, () => createQueuedItem("reddit")));

    const summary = await generateArticlesForQueue(llm, { championMap: null });
    expect(summary.results).toHaveLength(4);
  });
});
