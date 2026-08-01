-- CreateTable
CREATE TABLE "CategoryPublishPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PipelineRunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "collectedCount" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "generationSucceeded" INTEGER NOT NULL DEFAULT 0,
    "generationFailed" INTEGER NOT NULL DEFAULT 0,
    "publishedCount" INTEGER NOT NULL DEFAULT 0,
    "heldCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT
);
INSERT INTO "new_PipelineRunLog" ("candidateCount", "collectedCount", "errorMessage", "finishedAt", "generationFailed", "generationSucceeded", "heldCount", "id", "publishedCount", "startedAt", "status") SELECT "candidateCount", "collectedCount", "errorMessage", "finishedAt", "generationFailed", "generationSucceeded", "heldCount", "id", "publishedCount", "startedAt", "status" FROM "PipelineRunLog";
DROP TABLE "PipelineRunLog";
ALTER TABLE "new_PipelineRunLog" RENAME TO "PipelineRunLog";
CREATE INDEX "PipelineRunLog_startedAt_idx" ON "PipelineRunLog"("startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CategoryPublishPolicy_category_key" ON "CategoryPublishPolicy"("category");
