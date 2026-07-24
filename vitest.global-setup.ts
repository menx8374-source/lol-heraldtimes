/**
 * Vitestのグローバルセットアップ。パイプライン統合テスト（Sprint 7）はPrisma+SQLiteに実際に
 * 書き込むため、開発用DB(dev.db)を汚さないよう専用のテストDBファイルを用意し、
 * DATABASE_URLをテスト実行中だけ差し替える。
 * ここで設定した process.env は後続のテストプロセスへ引き継がれる（Vitestの仕様）。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TEST_DB_PATH = path.resolve(__dirname, "prisma/test.db");

export default async function setup() {
  // 前回実行の残骸を消し、毎回まっさらなスキーマから決定論的にテストできるようにする。
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const p = `${TEST_DB_PATH}${suffix}`;
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  const databaseUrl = `file:${TEST_DB_PATH.replace(/\\/g, "/")}`;
  process.env.DATABASE_URL = databaseUrl;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
