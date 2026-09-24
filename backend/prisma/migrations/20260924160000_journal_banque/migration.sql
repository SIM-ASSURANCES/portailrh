-- CreateEnum
CREATE TYPE "TypeMouvementBanque" AS ENUM ('SORTIE', 'RETOUR', 'ANNULATION');

-- CreateTable
CREATE TABLE "JournalBanque" (
    "id" TEXT NOT NULL,
    "type" "TypeMouvementBanque" NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "reglementId" TEXT NOT NULL,
    "retourCaisseId" TEXT,
    "pieceJointeId" TEXT,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalBanque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalBanque_pieceJointeId_key" ON "JournalBanque"("pieceJointeId");
CREATE INDEX "JournalBanque_reglementId_idx" ON "JournalBanque"("reglementId");

-- AddForeignKey
ALTER TABLE "JournalBanque" ADD CONSTRAINT "JournalBanque_reglementId_fkey" FOREIGN KEY ("reglementId") REFERENCES "Reglement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalBanque" ADD CONSTRAINT "JournalBanque_retourCaisseId_fkey" FOREIGN KEY ("retourCaisseId") REFERENCES "RetourCaisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalBanque" ADD CONSTRAINT "JournalBanque_pieceJointeId_fkey" FOREIGN KEY ("pieceJointeId") REFERENCES "PieceJointe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalBanque" ADD CONSTRAINT "JournalBanque_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rattrapage : les règlements Banque déjà confirmés (et annulés) reçoivent leur écriture SORTIE (+ ANNULATION) pour un historique complet.
INSERT INTO "JournalBanque" ("id", "type", "montant", "reglementId", "creeParId", "creeAt")
SELECT 'jb_s_' || r."id", 'SORTIE', r."montant", r."id", r."auteurId", COALESCE(r."confirmeAt", r."createdAt")
FROM "Reglement" r WHERE r."mode" = 'BANQUE' AND r."estConfirme" = true;
INSERT INTO "JournalBanque" ("id", "type", "montant", "reglementId", "creeParId", "creeAt")
SELECT 'jb_a_' || r."id", 'ANNULATION', r."montant", r."id", r."auteurId", r."createdAt"
FROM "Reglement" r WHERE r."mode" = 'BANQUE' AND r."estConfirme" = true AND r."estAnnule" = true;
