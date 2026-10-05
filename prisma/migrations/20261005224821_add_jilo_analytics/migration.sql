-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "meta" JSONB,
ADD COLUMN     "permalink" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT;

-- CreateTable
CREATE TABLE "MediaInsightSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "igMediaId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "reach" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "saved" INTEGER,
    "shares" INTEGER,
    "reposts" INTEGER,
    "totalInteractions" INTEGER,
    "avgWatchTimeMs" INTEGER,
    "totalWatchTimeMs" DOUBLE PRECISION,
    "skipRatePct" DOUBLE PRECISION,
    "followersCount" INTEGER,
    "errors" JSONB,
    "raw" JSONB NOT NULL,

    CONSTRAINT "MediaInsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostAnalysis" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT,
    "basedOnSnapshotId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MediaInsightSnapshot_postId_capturedAt_idx" ON "MediaInsightSnapshot"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "MediaInsightSnapshot_capturedAt_idx" ON "MediaInsightSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostAnalysis_postId_key" ON "PostAnalysis"("postId");

-- CreateIndex
CREATE INDEX "Post_source_idx" ON "Post"("source");

-- AddForeignKey
ALTER TABLE "MediaInsightSnapshot" ADD CONSTRAINT "MediaInsightSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostAnalysis" ADD CONSTRAINT "PostAnalysis_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
