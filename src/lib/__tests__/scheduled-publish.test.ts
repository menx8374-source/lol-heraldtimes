/**
 * 予約投稿（拡張E7）の時刻判定・昇格処理のテスト。isScheduleDueは純関数として単体テストし、
 * promoteScheduledArticlesはDB結合テストで「到来分のみ公開へ昇格・未到来は非公開のまま」を検証する。
 * runFullPipeline統合による自動昇格の確認も含む。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { isScheduleDue, promoteScheduledArticles } from "@/lib/generation/scheduled-publish";
import { PUBLISHED_ONLY } from "@/lib/articles";
import { runFullPipeline } from "@/lib/pipeline/run-pipeline";

describe("isScheduleDue（純関数）", () => {
  it("予約時刻が現在時刻以前なら到来している", () => {
    expect(isScheduleDue(new Date("2026-07-25T00:00:00Z"), new Date("2026-07-25T00:00:01Z"))).toBe(true);
  });
  it("予約時刻ちょうどでも到来扱い(<=)", () => {
    const t = new Date("2026-07-25T00:00:00Z");
    expect(isScheduleDue(t, t)).toBe(true);
  });
  it("予約時刻が未来なら未到来", () => {
    expect(isScheduleDue(new Date("2026-07-25T00:00:01Z"), new Date("2026-07-25T00:00:00Z"))).toBe(false);
  });
});

async function resetDb() {
  await prisma.pipelineRunLog.deleteMany();
  await prisma.sourceFetchLog.deleteMany();
  await prisma.articleSource.deleteMany();
  await prisma.articleTag.deleteMany();
  await prisma.collectedItem.deleteMany();
  await prisma.article.deleteMany();
  await prisma.tag.deleteMany();
}

async function createScheduledArticle(slug: string, scheduledAt: Date) {
  return prisma.article.create({
    data: {
      slug,
      title: `予約記事 ${slug}`,
      category: "パッチ/メタ",
      body: [{ type: "paragraph", text: "本文" }],
      publishedAt: new Date("2000-01-01T00:00:00Z"), // 昇格時に scheduledAt へ更新されることを確認するため大きく異なる初期値にする
      status: "scheduled",
      scheduledAt,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

describe("promoteScheduledArticles（DB結合）", () => {
  it("scheduledAtが到来した記事のみ公開へ昇格し、publishedAtがscheduledAtに揃う", async () => {
    const now = new Date("2026-07-25T12:00:00Z");
    const due = await createScheduledArticle("due-article", new Date("2026-07-25T11:00:00Z"));
    const notDue = await createScheduledArticle("not-due-article", new Date("2026-07-25T13:00:00Z"));

    const result = await promoteScheduledArticles(now);
    expect(result.publishedCount).toBe(1);
    expect(result.articleIds).toEqual([due.id]);

    const promoted = await prisma.article.findUniqueOrThrow({ where: { id: due.id } });
    expect(promoted.status).toBe("published");
    expect(promoted.publishedAt.toISOString()).toBe(new Date("2026-07-25T11:00:00Z").toISOString());

    const stillScheduled = await prisma.article.findUniqueOrThrow({ where: { id: notDue.id } });
    expect(stillScheduled.status).toBe("scheduled");

    const publicCount = await prisma.article.count({ where: PUBLISHED_ONLY });
    expect(publicCount).toBe(1);
  });

  it("対象0件でも正常終了する", async () => {
    const result = await promoteScheduledArticles(new Date());
    expect(result).toEqual({ publishedCount: 0, articleIds: [] });
  });
});

describe("runFullPipeline統合による予約公開の自動昇格", () => {
  it("npm run pipeline相当の実行で、到来済みscheduled記事が自動的に公開へ昇格する", async () => {
    const now = new Date("2026-07-25T12:00:00Z");
    const due = await createScheduledArticle("pipeline-due-article", new Date("2026-07-25T11:59:00Z"));

    const report = await runFullPipeline({ adapters: [], now });
    expect(report.scheduledPublishedCount).toBe(1);

    const promoted = await prisma.article.findUniqueOrThrow({ where: { id: due.id } });
    expect(promoted.status).toBe("published");
  });
});
