-- CreateEnum
CREATE TYPE "StatutRetourExceptionnel" AS ENUM ('EN_ATTENTE_VALIDATION', 'VALIDE', 'REJETE');

-- CreateTable
CREATE TABLE "RetourExceptionnel" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "motif" TEXT NOT NULL,
    "statut" "StatutRetourExceptionnel" NOT NULL DEFAULT 'EN_ATTENTE_VALIDATION',
    "saisiParId" TEXT NOT NULL,
    "saisiAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valideParId" TEXT,
    "valideAt" TIMESTAMP(3),
    "motifRejet" TEXT,

    CONSTRAINT "RetourExceptionnel_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PieceJointe" ADD COLUMN "retourExceptionnelId" TEXT;

-- CreateIndex
CREATE INDEX "RetourExceptionnel_demandeId_idx" ON "RetourExceptionnel"("demandeId");
CREATE INDEX "RetourExceptionnel_statut_idx" ON "RetourExceptionnel"("statut");
CREATE UNIQUE INDEX "PieceJointe_retourExceptionnelId_key" ON "PieceJointe"("retourExceptionnelId");

-- AddForeignKey
ALTER TABLE "RetourExceptionnel" ADD CONSTRAINT "RetourExceptionnel_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetourExceptionnel" ADD CONSTRAINT "RetourExceptionnel_saisiParId_fkey" FOREIGN KEY ("saisiParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetourExceptionnel" ADD CONSTRAINT "RetourExceptionnel_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_retourExceptionnelId_fkey" FOREIGN KEY ("retourExceptionnelId") REFERENCES "RetourExceptionnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
