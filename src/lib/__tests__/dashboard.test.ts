/**
 * 運営監視ダッシュボード（F14, Sprint 9）データ集約のテスト。
 * mergeFailureLogsは純関数として単体テストし、DBに依存する取得関数群は
 * 専用テストDB（vitest.global-setup.ts）に対する結合テストで検証する。
 */
import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  mergeFailureLogs,
  listRunHistory,
  countPublishedArticles,
  listFailureLog,
} from "@/lib/dashboard";

describe("mergeFailureLogs（収集/生成/パイプラインの失敗ログ統合, 純関数）", () => {
  it("3種類の失敗ログを発生日時の新しい順に1本へ統合する", () => {
    const merged = mergeFailureLogs(
      [{ sourceType: "5ch", runAt: new Date("2026-07-20T01:00:00Z"), errorMessage: "接続失敗" }],
      [{ title: "候補記事A", updatedAt: new Date("2026-07-20T03:00:00Z"), generationError: "本文が短すぎる" }],
      [{ startedAt: new Date("2026-07-20T02:00:00Z"), errorMessage: "想定外の例外" }],
    );

    expect(merged.map((e) => e.stage)).toEqual(["generation", "pipeline", "collection"]);
    expect(merged[0]).toMatchObject({ subject: "候補記事A", message: "本文が短すぎる" });
    expect(merged[2]).toMatchObject({ subject: "5ch", message: "接続失敗" });
  });

  it("エラーメッセージが無い行はデフォルト文言で埋める", () => {
    const merged = mergeFailureLogs(
      [{ sourceType: "reddit", runAt: new Date("2026-07-20T00:00:00Z"), errorMessage: null }],
      [],
      [],
    );
    expect(merged[0].message).toBe("エラー詳細不明");
  });

  it("失敗が1件も無ければ空配列を返す", () => {
    expect(mergeFailureLogs([], [], [])).toEqual([]);
  });
});

describe("ダッシュボードのDB取得関数（結合テスト）", () => {
  async function resetDb() {
    await prisma.pipelineRunLog.deleteMany();
    await prisma.sourceFetchLog.deleteMany();
    await prisma.articleSource.deleteMany();
    await prisma.articleTag.deleteMany();
    await prisma.collectedItem.deleteMany();
    await prisma.article.deleteMany();
    await prisma.tag.deleteMany();
  }

  beforeEach(async () => {
    await resetDb();
  });

  it("listRunHistoryは実行ログを新しい順で返す", async () => {
    await prisma.pipelineRunLog.create({
      data: {
        startedAt: new Date("2026-07-20T00:00:00Z"),
        finishedAt: new Date("2026-07-20T00:01:00Z"),
        status: "success",
        collectedCount: 3,
        candidateCount: 2,
        generationSucceeded: 2,
        generationFailed: 0,
        publishedCount: 2,
        heldCount: 0,
      },
    });
    await prisma.pipelineRunLog.create({
      data: {
        startedAt: new Date("2026-07-21T00:00:00Z"),
        finishedAt: new Date("2026-07-21T00:01:00Z"),
        status: "success",
        collectedCount: 1,
        candidateCount: 1,
        generationSucceeded: 0,
        generationFailed: 1,
        publishedCount: 0,
        heldCount: 0,
      },
    });

    const history = await listRunHistory();
    expect(history).toHaveLength(2);
    expect(history[0].startedAt.toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(history[0].generationFailed).toBe(1);
    expect(history[1].collectedCount).toBe(3);
  });

  it("countPublishedArticlesは公開記事のみを数える(保留記事は含めない)", async () => {
    await prisma.article.create({
      data: {
        slug: "published-1",
        title: "公開記事1",
        category: "news",
        body: JSON.stringify([{ type: "paragraph", text: "本文" }]),
        publishedAt: new Date("2026-07-20T00:00:00Z"),
        status: "published",
      },
    });
    await prisma.article.create({
      data: {
        slug: "held-1",
        title: "保留記事1",
        category: "news",
        body: JSON.stringify([{ type: "paragraph", text: "本文" }]),
        publishedAt: new Date("2026-07-20T00:00:00Z"),
        status: "held",
        heldReason: "ng_word",
        heldDetail: "NGワードを含む",
      },
    });

    expect(await countPublishedArticles()).toBe(1);
  });

  it("listFailureLogは収集/生成/パイプラインの失敗を統合して返す", async () => {
    await prisma.sourceFetchLog.create({
      data: { sourceType: "5ch", status: "failure", errorMessage: "接続タイムアウト" },
    });
    await prisma.collectedItem.create({
      data: {
        sourceType: "riot",
        sourceUrl: "https://example.com/a",
        normalizedUrl: "https://example.com/a",
        title: "生成に失敗した候補",
        content: "内容",
        fetchedAt: new Date("2026-07-20T00:00:00Z"),
        status: "generation_failed",
        generationError: "本文が最低文字数未満",
      },
    });
    await prisma.pipelineRunLog.create({
      data: {
        startedAt: new Date("2026-07-20T00:00:00Z"),
        finishedAt: new Date("2026-07-20T00:01:00Z"),
        status: "failure",
        errorMessage: "想定外のDB異常",
      },
    });

    const failures = await listFailureLog();
    expect(failures).toHaveLength(3);
    expect(failures.map((f) => f.stage).sort()).toEqual(["collection", "generation", "pipeline"]);
  });
});
