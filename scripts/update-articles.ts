/**
 * 記事更新（伸びたら条件付き再AI）の単独実行スクリプト（リファクタリングS6 F-S6-3）。
 * `npm run update-articles` で実行する。articleが紐付き(記事化済み)かつ監視中(Post.monitoring=true)
 * のPostのうち、Scoreが大きく伸びた／コメントが急増したものだけ再AI更新する。cron常駐の登録自体は
 * 本スプリント対象外（1回実行のみ）。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { updateHotArticles } from "../src/lib/generation/article-updater";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("記事更新チェック開始");

  const result = await updateHotArticles({ now: new Date() });
  console.log(`  checked=${result.checked} updated=${result.updated} skipped=${result.skipped}`);

  console.log("記事更新チェック完了");
}

main()
  .catch((err) => {
    console.error("記事更新チェックの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
