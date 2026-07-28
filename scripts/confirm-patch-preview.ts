/**
 * 未適用パッチpreview記事の自動確定の単独実行スクリプト（パッチ記事刷新S5 F-S5-3）。
 * `npm run confirm-patch-preview` で実行する。`PATCH_PREVIEW_MODE=on`のときのみ動作し、
 * off/未設定では何もしない（`updateHotArticles`/`npm run update-articles`と同じ運用パターンで、
 * cron常駐の登録自体は本スプリント対象外・1回実行のみ）。
 */
// prisma を含む後続 import より前に .env を読み込む（cron/CLI からの tsx 直接起動用）。
import "dotenv/config";
import { confirmPatchPreviewArticles } from "../src/lib/generation/patch-preview-confirm";
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("パッチpreview記事の確定チェック開始");

  const result = await confirmPatchPreviewArticles({ now: new Date() });
  console.log(`  checked=${result.checked} confirmed=${result.confirmed} skipped=${result.skipped}`);

  console.log("パッチpreview記事の確定チェック完了");
}

main()
  .catch((err) => {
    console.error("パッチpreview記事の確定チェックの実行に失敗しました:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
