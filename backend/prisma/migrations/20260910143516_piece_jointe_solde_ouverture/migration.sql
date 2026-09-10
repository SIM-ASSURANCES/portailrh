-- DropForeignKey
ALTER TABLE "PieceJointe" DROP CONSTRAINT "PieceJointe_demandeId_fkey";

-- AlterTable
ALTER TABLE "PieceJointe" ADD COLUMN     "journalCaisseId" TEXT,
ALTER COLUMN "demandeId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PieceJointe_journalCaisseId_key" ON "PieceJointe"("journalCaisseId");

-- AddForeignKey
ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_journalCaisseId_fkey" FOREIGN KEY ("journalCaisseId") REFERENCES "JournalCaisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
