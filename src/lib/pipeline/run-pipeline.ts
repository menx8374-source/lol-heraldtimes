/**
 * 統合パイプライン（F10: 収集→重複排除→記事生成→タイトル生成→安全フィルタ→公開）のオーケストレーション。
 * Sprint 3〜6 で個別に実装した各工程（収集: collection/pipeline.ts、重複排除: collection/queue.ts、
 * 生成+タイトル+安全フィルタ+公開ゲート: generation/pipeline.ts）を1本の関数としてつなぐだけで、
 * 各工程自体のロジックは変更しない。
 *
 * F11（エラー耐性・運営ログ）:
 * - 収集の1ソース失敗・生成/タイトルの1候補失敗は、それぞれの工程が既に「握りつぶさず記録しつつ
 *   継続する」設計になっている（collection/pipeline.ts・generation/pipeline.ts）。
 * - ここでは各工程をまたぐ想定外の例外（DB異常等）に対する最後の安全網としてtry/catchを1つ持ち、
 *   万一の例外でもパイプライン全体をクラッシュさせず、実行ログに記録して正常終了する。
 * - 実行ごとに収集件数・記事化候補数・生成成功/失敗数・公開数・保留数を PipelineRunLog に記録する。
 */
import { prisma } from "@/lib/prisma";
import { runCollectionPipeline, type SourceRunSummary } from "@/lib/collection/pipeline";
import { rebuildCandidateQueue } from "@/lib/collection/queue";
import { getAllAdapters } from "@/lib/collection/adapters";
import { getDefaultSourceConfigs } from "@/lib/collection/config";
import type { SourceAdapter, SourceConfig, SourceType } from "@/lib/collection/types";
import {
  generateArticlesForQueue,
  type GenerationRunResult,
  type GenerationRunSummary,
} from "@/lib/generation/pipeline";
import {
  generateArticlesFromHotPosts,
  type PostGenerationRunResult,
  type PostGenerationRunSummary,
} from "@/lib/generation/post-pipeline";
import type { ChampionNameToIdMap } from "@/lib/generation/champion-thumbnail";
import { getLLMClient, type LLMClient } from "@/lib/generation/llm-client";
import { getPipelineConfig, getGenerationSource, type GenerationSource } from "@/lib/pipeline/config";
import { promoteScheduledArticles } from "@/lib/generation/scheduled-publish";
import { notifyPublishedArticles } from "@/lib/generation/delivery";

export type PipelineRunOptions = {
  /** 収集に使うアダプタ群。未指定時は設定（COLLECTION_MODE）に従った既定アダプタ。 */
  adapters?: SourceAdapter[];
  sourceConfigs?: Record<SourceType, SourceConfig>;
  llmClient?: LLMClient;
  now?: Date;
  /**
   * 1回の実行で処理する候補数（≒公開本数）の総数上限（後方互換）。明示的に指定された場合は
   * こちらを優先し、従来どおり総数上限で generateArticlesForQueue を呼ぶ（maxPerCategory は使わない）。
   * 未指定時は下の maxPerCategory（カテゴリ=ソース別上限、拡張E48）が主制御になる。
   */
  maxPublishPerRun?: number;
  /**
   * カテゴリ(=ソース種別)別の1回の実行あたり公開本数上限（拡張E48）。未指定時は設定
   * (PIPELINE_MAX_PUBLISH_PER_CATEGORY)。maxPublishPerRun が明示指定された場合はそちらを優先する。
   */
  maxPerCategory?: number;
  /**
   * チャンピオン検出（拡張E31 F-E31-1）用Map。generateArticlesForQueue にそのまま渡す
   * （未指定undefinedならrun開始時に1回だけ実フェッチ、明示的にnullならフェッチ自体をスキップ）。
   */
  championMap?: ChampionNameToIdMap | null;
  /**
   * 生成経路の切替（リファクタリングS5a F-S5a-2）。未指定時は env `GENERATION_SOURCE`
   * （`getGenerationSource()`、既定 "post"）に従う。"post": hot判定されたPostだけをAIで記事化する
   * 新フロー（既定）。"collected": 従来の CollectedItem→記事化（旧経路、比較用）。
   */
  generationSource?: GenerationSource;

  // 以下はテスト用の差し替えフック（想定外の例外に対する安全網を検証するため）。
  // 通常運用では指定不要（既定で実工程を呼ぶ）。
  runCollection?: typeof runCollectionPipeline;
  rebuildQueue?: typeof rebuildCandidateQueue;
  /** generationSource="collected" のときに使う生成関数（旧経路）。 */
  generateArticles?: typeof generateArticlesForQueue;
  /** generationSource="post"（既定）のときに使う生成関数（新フロー）。 */
  generatePostArticles?: typeof generateArticlesFromHotPosts;
  promoteScheduled?: typeof promoteScheduledArticles;
};

export type PipelineRunReport = {
  startedAt: Date;
  finishedAt: Date;
  /** "success": 想定内の個別失敗を含め正常終了。 "failure": 想定外の例外で異常終了（それでも例外は投げない）。 */
  status: "success" | "failure";
  collectedCount: number;
  candidateCount: number;
  generationSucceeded: number;
  generationFailed: number;
  publishedCount: number;
  heldCount: number;
  /** 予約公開（拡張E7）: このパイプライン実行で scheduledAt 到来により公開へ昇格した件数。 */
  scheduledPublishedCount: number;
  errorMessage?: string;
  sourceSummaries: SourceRunSummary[];
  /** generationSource（"post"既定 or "collected"）に応じてどちらかの型のサマリが入る。 */
  generationSummary?: GenerationRunSummary | PostGenerationRunSummary;
};

/**
 * 生成結果のうち「今回この工程で新規に即時公開された(status="published")」ものだけを絞り込む型ガード
 * （成長G6 F-G6-3の配信導線通知対象を集めるため）。scheduledやheld・failureは対象にしない。
 */
function isNewlyPublishedSuccess(
  r: GenerationRunResult | PostGenerationRunResult,
): r is (GenerationRunResult | PostGenerationRunResult) & { status: "success"; articleId: string } {
  return r.status === "success" && r.publicationStatus === "published";
}

/** 実行ログの保存。保存自体の失敗は実行結果に影響させず、コンソールに残すだけにする。 */
async function persistRunLog(report: PipelineRunReport): Promise<void> {
  await prisma.pipelineRunLog
    .create({
      data: {
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        status: report.status,
        collectedCount: report.collectedCount,
        candidateCount: report.candidateCount,
        generationSucceeded: report.generationSucceeded,
        generationFailed: report.generationFailed,
        publishedCount: report.publishedCount,
        heldCount: report.heldCount,
        errorMessage: report.errorMessage,
      },
    })
    .catch((err) => console.error("PipelineRunLogの保存に失敗しました:", err));
}

/**
 * 統合パイプラインを1回実行する。人手介入なしで
 * 収集→重複排除→記事生成→タイトル生成→安全フィルタ→公開まで完走する。
 * 候補が枯渇していれば0件公開のまま正常終了し、想定外の例外が起きてもクラッシュせず
 * ログに残して正常終了する（F10・F11）。
 */
export async function runFullPipeline(options: PipelineRunOptions = {}): Promise<PipelineRunReport> {
  const startedAt = options.now ?? new Date();
  const pipelineConfig = getPipelineConfig();
  // maxPublishPerRun が明示指定された場合のみ総数上限（旧挙動・後方互換）を使い、
  // それ以外は maxPerCategory（カテゴリ=ソース別上限、拡張E48）を主制御にする。
  const maxPublishPerRun = options.maxPublishPerRun;
  const maxPerCategory = options.maxPerCategory ?? pipelineConfig.maxPublishPerCategory;

  const generationSource = options.generationSource ?? getGenerationSource();
  const runCollection = options.runCollection ?? runCollectionPipeline;
  const rebuildQueue = options.rebuildQueue ?? rebuildCandidateQueue;
  const generateArticles = options.generateArticles ?? generateArticlesForQueue;
  const generatePostArticles = options.generatePostArticles ?? generateArticlesFromHotPosts;
  const promoteScheduled = options.promoteScheduled ?? promoteScheduledArticles;

  let sourceSummaries: SourceRunSummary[] = [];
  let collectedCount = 0;
  let candidateCount = 0;
  let generationSucceeded = 0;
  let generationFailed = 0;
  let publishedCount = 0;
  let heldCount = 0;
  let scheduledPublishedCount = 0;
  let generationSummary: GenerationRunSummary | PostGenerationRunSummary | undefined;
  let status: "success" | "failure" = "success";
  let errorMessage: string | undefined;

  // 配信導線（成長G6 F-G6-3）: このパイプライン実行で「新規に公開された」記事のIDだけを集め、
  // try/catchを抜けたあとにまとめてDiscordへ通知する（実行単位の新規公開のみが対象＝二重通知しない）。
  const newlyPublishedArticleIds: string[] = [];

  try {
    // 予約投稿（拡張E7）: scheduledAt <= startedAt の記事を先に公開へ昇格する。
    const promotion = await promoteScheduled(startedAt);
    scheduledPublishedCount = promotion.publishedCount;
    newlyPublishedArticleIds.push(...promotion.articleIds);

    const adapters = options.adapters ?? getAllAdapters();
    const sourceConfigs = options.sourceConfigs ?? getDefaultSourceConfigs();
    sourceSummaries = await runCollection(adapters, sourceConfigs, startedAt);
    collectedCount = sourceSummaries.reduce((sum, s) => sum + s.savedCount, 0);

    const queueSummary = await rebuildQueue();
    candidateCount = queueSummary.queuedCount;

    const llmClient = options.llmClient ?? getLLMClient();
    if (generationSource === "collected") {
      // 旧経路（比較用）: CollectedItem候補キューから記事化する。
      generationSummary = await generateArticles(
        llmClient,
        maxPublishPerRun != null
          ? { maxCandidates: maxPublishPerRun, championMap: options.championMap, now: startedAt }
          : { maxPerCategory, championMap: options.championMap, now: startedAt },
      );
    } else {
      // 既定の新フロー: hot判定された未記事化PostだけをAIで記事化する（リファクタリングS5a）。
      generationSummary = await generatePostArticles(llmClient, {
        maxPerCategory,
        now: startedAt,
        championMap: options.championMap,
      });
    }
    generationSucceeded = generationSummary.succeededCount;
    generationFailed = generationSummary.failedCount;
    publishedCount = generationSummary.results.filter(
      (r) => r.status === "success" && r.publicationStatus === "published",
    ).length;
    heldCount = generationSummary.results.filter(
      (r) => r.status === "success" && r.publicationStatus === "held",
    ).length;
    newlyPublishedArticleIds.push(
      ...generationSummary.results.filter(isNewlyPublishedSuccess).map((r) => r.articleId),
    );
  } catch (err) {
    // 収集・生成・タイトル・フィルタの各工程は個別に失敗を握りつぶす設計だが、
    // それらをまたぐ想定外の例外（DB異常等）が万一漏れてもパイプライン全体を止めない最後の安全網。
    status = "failure";
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("統合パイプラインの実行で想定外のエラーが発生しました:", err);
  }

  // 配信導線（成長G6 F-G6-3）: DISCORD_WEBHOOK_URL未設定ならnotifyPublishedArticles内でno-op。
  // 通知の準備・送信の失敗はパイプライン本体の成否に一切影響させない（補助処理は本体を止めない）。
  if (newlyPublishedArticleIds.length > 0) {
    try {
      const articles = await prisma.article.findMany({
        where: { id: { in: newlyPublishedArticleIds } },
        select: { title: true, slug: true, category: true },
      });
      await notifyPublishedArticles(articles);
    } catch (err) {
      console.error("Discord通知の準備に失敗しました:", err);
    }
  }

  const finishedAt = new Date();
  const report: PipelineRunReport = {
    startedAt,
    finishedAt,
    status,
    collectedCount,
    candidateCount,
    generationSucceeded,
    generationFailed,
    publishedCount,
    heldCount,
    scheduledPublishedCount,
    errorMessage,
    sourceSummaries,
    generationSummary,
  };

  await persistRunLog(report);
  return report;
}
