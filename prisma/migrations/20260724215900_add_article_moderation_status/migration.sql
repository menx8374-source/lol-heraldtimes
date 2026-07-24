-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "thumbnailUrl" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'published',
    "heldReason" TEXT,
    "heldDetail" TEXT,
    "unconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Article" ("body", "category", "createdAt", "id", "publishedAt", "slug", "thumbnailUrl", "title", "updatedAt", "viewCount") SELECT "body", "category", "createdAt", "id", "publishedAt", "slug", "thumbnailUrl", "title", "updatedAt", "viewCount" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");
CREATE INDEX "Article_category_idx" ON "Article"("category");
CREATE INDEX "Article_status_idx" ON "Article"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
