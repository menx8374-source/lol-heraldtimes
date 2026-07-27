/**
 * メトリクス定期更新の単独実行スクリプト（リファクタリングS4 F-S4-4）。`npm run update-metrics` で実行する。
 * 監視中(Post.monitoring=true)のPostのうち、バックオフ間隔でdueなものだけメトリクスを再取得し
 * PostMetricsHistoryへ追記する。cron常駐の登録自体は本スプリント対象外（1回実行のみ）。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { updateDueMetrics } from "../src/lib/collection/metrics-updater";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("メトリクス更新開始");

  const result = await updateDueMetrics({ now: new Date() });
  console.log(`  checked=${result.checked} updated=${result.updated} retired=${result.retired}`);

  console.log("メトリクス更新完了");
}

main()
  .catch((err) => {
    console.error("メトリクス更新の実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
