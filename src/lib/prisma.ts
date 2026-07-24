import { PrismaClient } from "@prisma/client";

// Next.js の dev サーバーはモジュールを何度もリロードするため、
// グローバルにキャッシュして PrismaClient の多重生成を防ぐ（公式推奨パターン）。
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
