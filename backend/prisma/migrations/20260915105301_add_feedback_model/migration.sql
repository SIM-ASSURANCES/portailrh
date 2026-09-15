-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "source" "FeedbackSource" NOT NULL,
    "submittedAt" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isModerated" BOOLEAN NOT NULL DEFAULT false,
    "motifModeration" TEXT,
    "moderatedById" TEXT,
    "moderatedAt" TIMESTAMP(3),

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_recipientId_idx" ON "Feedback"("recipientId");

-- CreateIndex
CREATE INDEX "Feedback_source_idx" ON "Feedback"("source");

-- CreateIndex
CREATE INDEX "Feedback_isModerated_idx" ON "Feedback"("isModerated");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
