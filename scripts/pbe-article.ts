/**
 * PBE記事の生成/上書き更新の単独実行スクリプト（PBE-S4 F-PBE4-2）。
 * `npm run pbe-article` で実行する。`PBE_ARTICLE_MODE=on`のときのみ動作し、
 * off/未設定では何もしない（`confirm-patch-preview`/`update-articles`と同じ運用パターン。
 * cron常駐の登録自体は本スプリント対象外・1回実行のみ）。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { runPbeArticleGeneration } from "../src/lib/generation/pbe-article";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("PBE記事の生成/更新チェック開始");

  const result = await runPbeArticleGeneration(new Date());
  console.log(`  status=${result.status}`, result);

  console.log("PBE記事の生成/更新チェック完了");
}

main()
  .catch((err) => {
    console.error("PBE記事の生成/更新チェックの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
