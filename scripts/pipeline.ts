/**
 * 統合パイプラインの単独実行スクリプト。`npm run pipeline` で実行する（F10）。
 * 収集→重複排除→記事生成→タイトル生成→安全フィルタ→公開までを人手介入なしで1回実行し、
 * 実行結果のサマリ（収集件数・記事化候補数・生成成功/失敗数・公開数・保留数）を標準出力へ表示する。
 * 実際のcron常駐は不要（brief方針）。繰り返し実行はこのスクリプトを間隔(PIPELINE_INTERVAL_MS)を
 * 空けて再度起動する運用を想定し、次回実行の目安時刻を表示するのみに留める。
 */
// .env を最初に読み込む（cron/CLIから tsx で直接起動されると Next.js のような自動読込が無く、
// prisma の DATABASE_URL 等が未設定になるため、prisma を含む後続 import より前に読み込む）。
import "dotenv/config";
import { runFullPipeline } from "../src/lib/pipeline/run-pipeline";
import { getPipelineConfig, computeNextRunAt } from "../src/lib/pipeline/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("統合パイプライン開始");

  const config = getPipelineConfig();
  console.log(`  設定: 公開本数上限=${config.maxPublishPerRun} / 実行間隔=${config.intervalMs}ms`);

  const report = await runFullPipeline();

  for (const s of report.sourceSummaries) {
    if (s.status === "success") {
      console.log(`  [収集:${s.sourceType}] success: fetched=${s.fetchedCount} saved=${s.savedCount}`);
    } else if (s.status === "skipped-rate-limited") {
      console.log(`  [収集:${s.sourceType}] skipped-rate-limited`);
    } else {
      console.log(`  [収集:${s.sourceType}] failure: ${s.errorMessage}`);
    }
  }

  // generationSource（既定"post"）に応じて結果の識別子が collectedItemId（旧経路）/ postId（新経路）
  // のどちらかになる（リファクタリングS5a）。"in"演算子でどちらの形かを判定してログ出力する。
  for (const r of report.generationSummary?.results ?? []) {
    const sourceId = "postId" in r ? `postId=${r.postId}` : `collectedItemId=${r.collectedItemId}`;
    if (r.status === "success") {
      const pub = r.publicationStatus === "held" ? `held(理由:${r.heldReason})` : "published";
      console.log(`  [生成] ${sourceId} -> articleId=${r.articleId} status=${pub}`);
    } else {
      console.log(`  [生成失敗] ${sourceId}: ${r.errorMessage}`);
    }
  }

  console.log(
    `実行サマリ: 収集=${report.collectedCount} 候補=${report.candidateCount} 生成成功=${report.generationSucceeded} 生成失敗=${report.generationFailed} 公開=${report.publishedCount} 保留=${report.heldCount} 予約公開昇格=${report.scheduledPublishedCount}`,
  );
  if (report.status === "failure") {
    console.log(`  ※想定外のエラーが発生しましたが、パイプラインは正常終了しました: ${report.errorMessage}`);
  }
  console.log(`次回実行の目安: ${computeNextRunAt(report.finishedAt, config.intervalMs).toISOString()}`);
  console.log("統合パイプライン完了");
}

main()
  .catch((err) => {
    // runFullPipeline内部の想定内/想定外の失敗はいずれも例外を投げずログに記録して正常終了する設計のため、
    // ここに到達するのはさらに想定外のバグのみ。その場合のみプロセスを異常終了させる。
    console.error("統合パイプラインの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
