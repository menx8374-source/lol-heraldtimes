/**
 * `scripts/pipeline.ts`（CLI実行スクリプト）のコンソール表示を組み立てる純関数群。
 * DB・LLM等の副作用を持たないため、CLI側から切り出してユニットテスト可能にする（admincms-S1 バグ修正）。
 */
import type { PostGenerationRunResult } from "@/lib/generation/post-pipeline";
import type { GenerationRunResult } from "@/lib/generation/pipeline";
import type { PipelineRunReport } from "@/lib/pipeline/run-pipeline";

type SuccessResult = Extract<GenerationRunResult | PostGenerationRunResult, { status: "success" }>;

/**
 * 生成成功1件の publicationStatus（"published"|"held"|"scheduled"|"review"）を、
 * CLIログ用の日本語ラベルに変換する。全値を網羅し、想定外の値が来ても素通しで表示する
 * （非網羅ternaryによる誤表示を防ぐ）。
 */
export function formatPublicationStatus(r: SuccessResult): string {
  switch (r.publicationStatus) {
    case "held":
      return `held(理由:${r.heldReason})`;
    case "review":
      return "review(要レビュー)";
    case "scheduled":
      return "scheduled(予約)";
    case "published":
      return "published";
    default: {
      // 将来 publicationStatus に値が追加された場合でも、ここで気づけるように値をそのまま出す。
      const exhaustiveCheck: never = r.publicationStatus;
      return String(exhaustiveCheck);
    }
  }
}

/** 実行サマリ1行分の文字列を組み立てる。 */
export function formatRunSummaryLine(
  report: Pick<
    PipelineRunReport,
    | "collectedCount"
    | "candidateCount"
    | "generationSucceeded"
    | "generationFailed"
    | "publishedCount"
    | "heldCount"
    | "reviewCount"
    | "scheduledPublishedCount"
  >,
): string {
  return (
    `実行サマリ: 収集=${report.collectedCount} 候補=${report.candidateCount} ` +
    `生成成功=${report.generationSucceeded} 生成失敗=${report.generationFailed} ` +
    `公開=${report.publishedCount} 保留=${report.heldCount} 要レビュー=${report.reviewCount} ` +
    `予約公開昇格=${report.scheduledPublishedCount}`
  );
}
