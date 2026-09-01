-- AlterTable
ALTER TABLE "PieceJointe" ADD COLUMN     "depenseLigneId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PieceJointe_depenseLigneId_key" ON "PieceJointe"("depenseLigneId");

-- AddForeignKey
ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_depenseLigneId_fkey" FOREIGN KEY ("depenseLigneId") REFERENCES "DepenseLigne"("id") ON DELETE CASCADE ON UPDATE CASCADE;
