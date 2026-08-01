/**
 * 運営監視ダッシュボード（F14, Sprint 9）のデータ集約。
 * 公開サイトの閲覧系クエリ（lib/articles.ts）とは完全に分離し、ここでしか使わない。
 * 認証は本スプリントのスコープ外（ナビ非露出 + robots除外で一般閲覧者からは辿れない前提）。
 */
import { prisma } from "@/lib/prisma";
import { PUBLISHED_ONLY, listPopularArticles, type ArticleSummary } from "@/lib/articles";
import { listHeldArticles, type HeldArticleSummary } from "@/lib/moderation/queue";

export type RunHistoryEntry = {
  startedAt: Date;
  finishedAt: Date;
  status: "success" | "failure";
  collectedCount: number;
  generationSucceeded: number;
  generationFailed: number;
  publishedCount: number;
  heldCount: number;
  /** カテゴリの公開ポリシーにより要レビュー(status="review")として保存された件数（admincms-S1 F3）。 */
  reviewCount: number;
  errorMessage: string | null;
};

/** 直近の実行結果を新しい順で時系列表示するための一覧。 */
export async function listRunHistory(limit = 20): Promise<RunHistoryEntry[]> {
  const rows = await prisma.pipelineRunLog.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status as "success" | "failure",
    collectedCount: r.collectedCount,
    generationSucceeded: r.generationSucceeded,
    generationFailed: r.generationFailed,
    publishedCount: r.publishedCount,
    heldCount: r.heldCount,
    reviewCount: r.reviewCount,
    errorMessage: r.errorMessage,
  }));
}

/** 公開記事の総数。 */
export async function countPublishedArticles(): Promise<number> {
  return prisma.article.count({ where: PUBLISHED_ONLY });
}

/** 人気記事ランキング（トップ表示と同じロジックを再利用）。 */
export async function getPopularArticlesForDashboard(limit = 10): Promise<ArticleSummary[]> {
  return listPopularArticles(limit);
}

/** 保留キュー（保留理由付き）。ダッシュボードで一覧するため件数を有界化する。 */
export async function getHeldArticlesForDashboard(limit = 50): Promise<HeldArticleSummary[]> {
  return listHeldArticles({ take: limit });
}

export type FailureLogEntry = {
  /** どの工程で失敗したか。 */
  stage: "collection" | "generation" | "pipeline";
  occurredAt: Date;
  /** 収集失敗ならソース種別、生成失敗なら記事候補のタイトル、パイプライン全体失敗なら固定文言。 */
  subject: string;
  message: string;
};

type CollectionFailureRow = { sourceType: string; runAt: Date; errorMessage: string | null };
type GenerationFailureRow = { title: string; updatedAt: Date; generationError: string | null };
type PipelineFailureRow = { startedAt: Date; errorMessage: string | null };

const NO_MESSAGE = "エラー詳細不明";

/**
 * 収集失敗（SourceFetchLog）・生成失敗（CollectedItem.generationError）・
 * パイプライン全体の想定外失敗（PipelineRunLog）という3種類の失敗ログを、
 * 「どの工程で何が失敗したか」を一目で追える1本の時系列に統合する純関数。
 */
export function mergeFailureLogs(
  collectionFailures: CollectionFailureRow[],
  generationFailures: GenerationFailureRow[],
  pipelineFailures: PipelineFailureRow[],
): FailureLogEntry[] {
  const entries: FailureLogEntry[] = [
    ...collectionFailures.map((f) => ({
      stage: "collection" as const,
      occurredAt: f.runAt,
      subject: f.sourceType,
      message: f.errorMessage ?? NO_MESSAGE,
    })),
    ...generationFailures.map((f) => ({
      stage: "generation" as const,
      occurredAt: f.updatedAt,
      subject: f.title,
      message: f.generationError ?? NO_MESSAGE,
    })),
    ...pipelineFailures.map((f) => ({
      stage: "pipeline" as const,
      occurredAt: f.startedAt,
      subject: "パイプライン全体",
      message: f.errorMessage ?? NO_MESSAGE,
    })),
  ];
  return entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
}

/** 3種の失敗ログをDBから取得し、統合した失敗ログ一覧を返す。 */
export async function listFailureLog(limit = 20): Promise<FailureLogEntry[]> {
  const [collectionFailures, generationFailures, pipelineFailures] = await Promise.all([
    prisma.sourceFetchLog.findMany({
      where: { status: "failure" },
      orderBy: { runAt: "desc" },
      take: limit,
      select: { sourceType: true, runAt: true, errorMessage: true },
    }),
    prisma.collectedItem.findMany({
      where: { status: "generation_failed" },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { title: true, updatedAt: true, generationError: true },
    }),
    prisma.pipelineRunLog.findMany({
      where: { status: "failure" },
      orderBy: { startedAt: "desc" },
      take: limit,
      select: { startedAt: true, errorMessage: true },
    }),
  ]);
  return mergeFailureLogs(collectionFailures, generationFailures, pipelineFailures).slice(0, limit);
}
