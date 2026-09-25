ALTER TABLE "RetourExterne" ADD COLUMN "pieceJointeChequeId" TEXT;
CREATE UNIQUE INDEX "RetourExterne_pieceJointeChequeId_key" ON "RetourExterne"("pieceJointeChequeId");
ALTER TABLE "RetourExterne" ADD CONSTRAINT "RetourExterne_pieceJointeChequeId_fkey" FOREIGN KEY ("pieceJointeChequeId") REFERENCES "PieceJointe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
