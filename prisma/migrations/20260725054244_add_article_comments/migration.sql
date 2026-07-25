-- CreateTable
CREATE TABLE "ArticleComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchors" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'published',
    "heldReason" TEXT,
    CONSTRAINT "ArticleComment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArticleComment_articleId_status_idx" ON "ArticleComment"("articleId", "status");

-- CreateIndex
CREATE INDEX "ArticleComment_status_createdAt_idx" ON "ArticleComment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleComment_articleId_number_key" ON "ArticleComment"("articleId", "number");
