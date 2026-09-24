-- DropForeignKey
ALTER TABLE "PieceJointe" DROP CONSTRAINT "PieceJointe_depenseLigneId_fkey";

-- AddForeignKey
ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_depenseLigneId_fkey" FOREIGN KEY ("depenseLigneId") REFERENCES "DepenseLigne"("id") ON DELETE SET NULL ON UPDATE CASCADE;
