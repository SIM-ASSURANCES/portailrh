-- DropForeignKey
ALTER TABLE "JournalCaisse" DROP CONSTRAINT "JournalCaisse_demandeId_fkey";

-- AlterTable
ALTER TABLE "JournalCaisse" ALTER COLUMN "demandeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "JournalCaisse" ADD CONSTRAINT "JournalCaisse_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE SET NULL ON UPDATE CASCADE;
