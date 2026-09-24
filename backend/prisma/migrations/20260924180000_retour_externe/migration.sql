CREATE TABLE "RetourExterne" (
    "id" TEXT NOT NULL,
    "collaborateurId" TEXT,
    "nomExterne" TEXT,
    "montantChequeInitial" DECIMAL(14,2) NOT NULL,
    "montantRetourne" DECIMAL(14,2) NOT NULL,
    "motif" TEXT NOT NULL,
    "pieceJointeId" TEXT NOT NULL,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetourExterne_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetourExterne_pieceJointeId_key" ON "RetourExterne"("pieceJointeId");
CREATE INDEX "RetourExterne_creeAt_idx" ON "RetourExterne"("creeAt");
ALTER TABLE "RetourExterne" ADD CONSTRAINT "RetourExterne_collaborateurId_fkey" FOREIGN KEY ("collaborateurId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RetourExterne" ADD CONSTRAINT "RetourExterne_pieceJointeId_fkey" FOREIGN KEY ("pieceJointeId") REFERENCES "PieceJointe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RetourExterne" ADD CONSTRAINT "RetourExterne_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
