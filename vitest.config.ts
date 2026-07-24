import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    // 複数のテストファイルがPrisma経由で同一の共有テストDB(prisma/test.db)へ実際に
    // 読み書きする（pipeline-run-pipeline.test.ts・seo-output.test.ts等）。ファイル単位の
    // 並列実行を許すとレース（あるファイルのdeleteManyが他ファイルの実行中データを消す等）で
    // 断続的に失敗するため、ファイルは直列実行にしてDB結合テストの決定性を優先する。
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
