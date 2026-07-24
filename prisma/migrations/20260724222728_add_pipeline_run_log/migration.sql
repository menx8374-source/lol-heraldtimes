-- CreateTable
CREATE TABLE "PipelineRunLog" (
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
    "errorMessage" TEXT
);

-- CreateIndex
CREATE INDEX "PipelineRunLog_startedAt_idx" ON "PipelineRunLog"("startedAt");
