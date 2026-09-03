-- AlterTable
ALTER TABLE "User" ADD COLUMN     "invitationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "invitationToken" TEXT,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_invitationToken_key" ON "User"("invitationToken");
