/**
 * 収集パイプラインの単独実行スクリプト。`npm run collect` で実行する。
 * 各ソース(reddit/5ch/riot)から収集アイテムを取り込み、重複排除して記事化候補キューを再構築し、
 * 実行結果のサマリを標準出力へ表示する(evaluatorが収集/候補キューの状態を確認できるように)。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { getAllAdapters } from "../src/lib/collection/adapters";
import { runCollectionPipeline } from "../src/lib/collection/pipeline";
import { rebuildCandidateQueue } from "../src/lib/collection/queue";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("収集パイプライン開始");

  const summaries = await runCollectionPipeline(getAllAdapters());
  for (const s of summaries) {
    if (s.status === "success") {
      console.log(`  [${s.sourceType}] success: fetched=${s.fetchedCount} saved=${s.savedCount}`);
    } else if (s.status === "skipped-rate-limited") {
      console.log(`  [${s.sourceType}] skipped-rate-limited (実行間隔内のためスキップ)`);
    } else {
      console.log(`  [${s.sourceType}] failure: ${s.errorMessage}`);
    }
  }

  const queueSummary = await rebuildCandidateQueue();
  console.log(
    `記事化候補キュー再構築: queued=${queueSummary.queuedCount} duplicate=${queueSummary.duplicateCount} alreadyArticled=${queueSummary.alreadyArticledCount}`,
  );

  const totalCollected = await prisma.collectedItem.count();
  console.log(`収集アイテム総数(DB): ${totalCollected}`);
  console.log("収集パイプライン完了");
}

main()
  .catch((err) => {
    console.error("収集パイプラインの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
