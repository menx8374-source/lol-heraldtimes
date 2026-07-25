/**
 * AIまとめ記事生成パイプラインの単独実行スクリプト。`npm run generate` で実行する。
 * 記事化候補キュー(status="queued")を1件ずつ処理し、Article(+ArticleSource)を作成する。
 * 失敗した候補は"generation_failed"として記録され、他候補の生成は継続する
 * (evaluatorが生成結果・候補状態を確認できるように結果を標準出力へ表示する)。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { generateArticlesForQueue } from "../src/lib/generation/pipeline";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("AIまとめ記事生成パイプライン開始");

  const summary = await generateArticlesForQueue();
  for (const r of summary.results) {
    if (r.status === "success") {
      const pub =
        r.publicationStatus === "held" ? `held(理由:${r.heldReason})` : "published";
      console.log(
        `  [success] collectedItemId=${r.collectedItemId} -> articleId=${r.articleId} slug=${r.slug} status=${pub}`,
      );
    } else {
      console.log(`  [failure] collectedItemId=${r.collectedItemId}: ${r.errorMessage}`);
    }
  }

  console.log(`生成結果: success=${summary.succeededCount} failure=${summary.failedCount}`);
  console.log("AIまとめ記事生成パイプライン完了");
}

main()
  .catch((err) => {
    console.error("記事生成パイプラインの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
