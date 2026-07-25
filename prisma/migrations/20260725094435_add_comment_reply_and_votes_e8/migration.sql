-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ArticleComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchors" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'published',
    "heldReason" TEXT,
    "parentId" TEXT,
    "goodCount" INTEGER NOT NULL DEFAULT 0,
    "badCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ArticleComment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ArticleComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ArticleComment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ArticleComment" ("anchors", "articleId", "body", "createdAt", "heldReason", "id", "name", "number", "status") SELECT "anchors", "articleId", "body", "createdAt", "heldReason", "id", "name", "number", "status" FROM "ArticleComment";
DROP TABLE "ArticleComment";
ALTER TABLE "new_ArticleComment" RENAME TO "ArticleComment";
CREATE INDEX "ArticleComment_articleId_status_idx" ON "ArticleComment"("articleId", "status");
CREATE INDEX "ArticleComment_status_createdAt_idx" ON "ArticleComment"("status", "createdAt");
CREATE INDEX "ArticleComment_articleId_parentId_idx" ON "ArticleComment"("articleId", "parentId");
CREATE UNIQUE INDEX "ArticleComment_articleId_number_key" ON "ArticleComment"("articleId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
