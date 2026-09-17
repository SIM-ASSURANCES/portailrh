-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('COLLABORATION', 'CONDITIONS_TRAVAIL');

-- DropForeignKey
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_recipientId_fkey";

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "ratings" JSONB,
ADD COLUMN     "type" "FeedbackType" NOT NULL DEFAULT 'COLLABORATION',
ALTER COLUMN "recipientId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Feedback_type_idx" ON "Feedback"("type");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
