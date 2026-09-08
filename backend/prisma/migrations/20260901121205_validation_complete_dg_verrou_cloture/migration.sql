-- AlterTable
ALTER TABLE "Demande" ADD COLUMN     "dgApprobateurId" TEXT,
ADD COLUMN     "dgApprouveAt" TIMESTAMP(3),
ADD COLUMN     "validationCompleteParDG" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Demande" ADD CONSTRAINT "Demande_dgApprobateurId_fkey" FOREIGN KEY ("dgApprobateurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
