/**
 * listCandidateQueue のソース種別フィルタ（拡張E48 F-E48-1）の結合テスト。
 * 専用テストDB（vitest.global-setup.ts で DATABASE_URL を差し替え済み）に対して実際にPrisma経由で
 * 書き込み、sourceType 指定時の絞り込みと take との併用・未指定時の回帰なしを検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { listCandidateQueue } from "@/lib/collection/queue";
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

let seq = 0;
function makeQueuedItem(sourceType: SourceType, status: "queued" | "pending" = "queued") {
  seq += 1;
  const sourceUrl = `https://example.com/${sourceType}/${seq}`;
  return prisma.collectedItem.create({
    data: {
      sourceType,
      sourceUrl,
      normalizedUrl: normalizeUrl(sourceUrl),
      title: `title-${seq}`,
      content: `content-${seq}`,
      fetchedAt: new Date(Date.now() - seq * 1000),
      status,
    },
  });
}

describe("listCandidateQueue（sourceType フィルタ、拡張E48）", () => {
  it("sourceType 指定時は、そのソース種別かつ queued のアイテムのみ返す", async () => {
    await makeQueuedItem("riot");
    await makeQueuedItem("5ch");
    await makeQueuedItem("5ch");
    await makeQueuedItem("reddit");

    const result = await listCandidateQueue({ sourceType: "5ch" });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.sourceType === "5ch")).toBe(true);
  });

  it("sourceType と take を併用すると、そのソース種別のうえで件数も絞られる", async () => {
    await makeQueuedItem("reddit");
    await makeQueuedItem("reddit");
    await makeQueuedItem("reddit");

    const result = await listCandidateQueue({ sourceType: "reddit", take: 2 });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.sourceType === "reddit")).toBe(true);
  });

  it("status=queued以外(pending等)は sourceType 指定時も対象に含まれない", async () => {
    await makeQueuedItem("riot", "queued");
    await makeQueuedItem("riot", "pending");

    const result = await listCandidateQueue({ sourceType: "riot" });
    expect(result).toHaveLength(1);
  });

  it("sourceType 未指定時は従来どおり全ソースが対象になる(回帰なし)", async () => {
    await makeQueuedItem("riot");
    await makeQueuedItem("5ch");
    await makeQueuedItem("reddit");

    const result = await listCandidateQueue();
    expect(result).toHaveLength(3);
  });
});
