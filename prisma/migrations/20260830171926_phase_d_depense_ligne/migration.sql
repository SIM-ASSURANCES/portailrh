/*
  Warnings:

  - You are about to drop the column `commentaire` on the `RetourCaisse` table. All the data in the column will be lost.
  - You are about to drop the column `justification` on the `RetourCaisse` table. All the data in the column will be lost.
  - You are about to drop the column `montantDepense` on the `RetourCaisse` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "RetourCaisse" DROP COLUMN "commentaire",
DROP COLUMN "justification",
DROP COLUMN "montantDepense";

-- CreateTable
CREATE TABLE "DepenseLigne" (
    "id" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "objet" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "nature" TEXT,
    "justification" "TypeJustification" NOT NULL,
    "commentaire" TEXT,
    "retourCaisseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepenseLigne_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DepenseLigne" ADD CONSTRAINT "DepenseLigne_retourCaisseId_fkey" FOREIGN KEY ("retourCaisseId") REFERENCES "RetourCaisse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
