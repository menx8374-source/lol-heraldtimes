-- CreateTable
CREATE TABLE "ArticleView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "viewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleView_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ArticleView_articleId_idx" ON "ArticleView"("articleId");

-- CreateIndex
CREATE INDEX "ArticleView_viewedAt_idx" ON "ArticleView"("viewedAt");
