-- AlterTable
ALTER TABLE "DepenseLigne" ADD COLUMN     "motifNonJustifie" TEXT,
ADD COLUMN     "motifNonJustifieAt" TIMESTAMP(3),
ADD COLUMN     "motifNonJustifieParId" TEXT;

-- AddForeignKey
ALTER TABLE "DepenseLigne" ADD CONSTRAINT "DepenseLigne_motifNonJustifieParId_fkey" FOREIGN KEY ("motifNonJustifieParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
