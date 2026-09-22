-- CreateEnum
CREATE TYPE "StatutLigneDemande" AS ENUM ('EN_ATTENTE', 'VALIDEE', 'REJETEE');

-- AlterTable
ALTER TABLE "LigneDemande" ADD COLUMN     "decideAt" TIMESTAMP(3),
ADD COLUMN     "decideParId" TEXT,
ADD COLUMN     "libelleOriginal" TEXT,
ADD COLUMN     "motifRejet" TEXT,
ADD COLUMN     "statutValidation" "StatutLigneDemande" NOT NULL DEFAULT 'EN_ATTENTE';

-- AddForeignKey
ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_decideParId_fkey" FOREIGN KEY ("decideParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
