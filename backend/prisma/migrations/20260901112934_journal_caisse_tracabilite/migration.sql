/*
  Warnings:

  - Added the required column `demandeId` to the `JournalCaisse` table without a default value. This is not possible if the table is not empty.
  - Added the required column `userId` to the `JournalCaisse` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "JournalCaisse" ADD COLUMN     "demandeId" TEXT NOT NULL,
ADD COLUMN     "userId" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "JournalCaisse" ADD CONSTRAINT "JournalCaisse_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalCaisse" ADD CONSTRAINT "JournalCaisse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
