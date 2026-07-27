-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT,
    "flair" TEXT,
    "media" JSONB,
    "postedAt" DATETIME NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME,
    "monitoring" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PostMetricsHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "commentCount" INTEGER NOT NULL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostMetricsHistory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleUpdateHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleUpdateHistory_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "scheduledAt" DATETIME,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "unconfirmed" BOOLEAN NOT NULL DEFAULT false,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "ogTitle" TEXT,
    "ogDescription" TEXT,
    "postId" TEXT,
    CONSTRAINT "Article_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Article" ("body", "category", "commentCount", "createdAt", "heldDetail", "heldReason", "id", "pinned", "publishedAt", "scheduledAt", "slug", "status", "thumbnailUrl", "title", "unconfirmed", "updatedAt", "viewCount") SELECT "body", "category", "commentCount", "createdAt", "heldDetail", "heldReason", "id", "pinned", "publishedAt", "scheduledAt", "slug", "status", "thumbnailUrl", "title", "unconfirmed", "updatedAt", "viewCount" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");
CREATE UNIQUE INDEX "Article_postId_key" ON "Article"("postId");
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");
CREATE INDEX "Article_category_idx" ON "Article"("category");
CREATE INDEX "Article_status_idx" ON "Article"("status");
CREATE INDEX "Article_status_scheduledAt_idx" ON "Article"("status", "scheduledAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Post_sourceType_idx" ON "Post"("sourceType");

-- CreateIndex
CREATE INDEX "Post_monitoring_idx" ON "Post"("monitoring");

-- CreateIndex
CREATE UNIQUE INDEX "Post_sourceType_externalId_key" ON "Post"("sourceType", "externalId");

-- CreateIndex
CREATE INDEX "PostMetricsHistory_postId_capturedAt_idx" ON "PostMetricsHistory"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "ArticleUpdateHistory_articleId_idx" ON "ArticleUpdateHistory"("articleId");
