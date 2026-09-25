CREATE TYPE "StatutRemboursementRetour" AS ENUM ('EN_ATTENTE_VALIDATION', 'VALIDE', 'REJETE');
ALTER TABLE "SignalementRetour" ADD COLUMN "montantPropose" DECIMAL(14,2);
ALTER TABLE "RetourCaisse" ADD COLUMN "signalementOrigineId" TEXT;
ALTER TABLE "RetourCaisse" ADD CONSTRAINT "RetourCaisse_signalementOrigineId_fkey" FOREIGN KEY ("signalementOrigineId") REFERENCES "SignalementRetour"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "RemboursementRetour" (
    "id" TEXT NOT NULL,
    "retourCaisseId" TEXT NOT NULL,
    "signalementId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "motif" TEXT NOT NULL,
    "pieceJointeId" TEXT NOT NULL,
    "statut" "StatutRemboursementRetour" NOT NULL DEFAULT 'EN_ATTENTE_VALIDATION',
    "proposeParId" TEXT NOT NULL,
    "proposeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valideParId" TEXT,
    "valideAt" TIMESTAMP(3),
    "motifRejet" TEXT,
    CONSTRAINT "RemboursementRetour_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RemboursementRetour_pieceJointeId_key" ON "RemboursementRetour"("pieceJointeId");
CREATE INDEX "RemboursementRetour_retourCaisseId_idx" ON "RemboursementRetour"("retourCaisseId");
CREATE INDEX "RemboursementRetour_statut_idx" ON "RemboursementRetour"("statut");
ALTER TABLE "RemboursementRetour" ADD CONSTRAINT "RemboursementRetour_retourCaisseId_fkey" FOREIGN KEY ("retourCaisseId") REFERENCES "RetourCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RemboursementRetour" ADD CONSTRAINT "RemboursementRetour_signalementId_fkey" FOREIGN KEY ("signalementId") REFERENCES "SignalementRetour"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RemboursementRetour" ADD CONSTRAINT "RemboursementRetour_pieceJointeId_fkey" FOREIGN KEY ("pieceJointeId") REFERENCES "PieceJointe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RemboursementRetour" ADD CONSTRAINT "RemboursementRetour_proposeParId_fkey" FOREIGN KEY ("proposeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RemboursementRetour" ADD CONSTRAINT "RemboursementRetour_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
