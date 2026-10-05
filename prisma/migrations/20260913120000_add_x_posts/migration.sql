-- CreateTable
CREATE TABLE "XPost" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mediaPath" TEXT,
    "status" "PostStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "tweetId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "XPost_workspaceId_idx" ON "XPost"("workspaceId");

-- CreateIndex
CREATE INDEX "XPost_status_idx" ON "XPost"("status");

-- CreateIndex
CREATE INDEX "XPost_scheduledAt_idx" ON "XPost"("scheduledAt");

-- AddForeignKey
ALTER TABLE "XPost" ADD CONSTRAINT "XPost_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
