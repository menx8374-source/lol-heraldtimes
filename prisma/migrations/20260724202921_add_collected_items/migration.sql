-- CreateTable
CREATE TABLE "CollectedItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "articleId" TEXT,
    CONSTRAINT "CollectedItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourceFetchLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectedItem_normalizedUrl_key" ON "CollectedItem"("normalizedUrl");

-- CreateIndex
CREATE INDEX "CollectedItem_sourceType_idx" ON "CollectedItem"("sourceType");

-- CreateIndex
CREATE INDEX "CollectedItem_status_idx" ON "CollectedItem"("status");

-- CreateIndex
CREATE INDEX "SourceFetchLog_sourceType_runAt_idx" ON "SourceFetchLog"("sourceType", "runAt");
