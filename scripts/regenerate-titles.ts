/**
 * 既存記事のタイトルを煽り速報タイトル(F8)で一括再生成する単独実行スクリプト。
 * `npm run regenerate-titles` で実行する。Sprint4以前に仮タイトルで生成された記事や、
 * 静的シード記事にも後から適用できるようにするための手段。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { regenerateAllArticleTitles } from "../src/lib/generation/pipeline";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("タイトル再生成パイプライン開始");

  const results = await regenerateAllArticleTitles();
  for (const r of results) {
    console.log(`  [${r.articleId}] "${r.oldTitle}" -> "${r.newTitle}"`);
  }

  console.log(`タイトル再生成結果: ${results.length}件`);
  console.log("タイトル再生成パイプライン完了");
}

main()
  .catch((err) => {
    console.error("タイトル再生成パイプラインの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
