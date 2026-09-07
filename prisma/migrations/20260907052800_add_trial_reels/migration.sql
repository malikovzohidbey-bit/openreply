-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "graduationStrategy" TEXT,
ADD COLUMN     "isTrialReel" BOOLEAN NOT NULL DEFAULT false;
