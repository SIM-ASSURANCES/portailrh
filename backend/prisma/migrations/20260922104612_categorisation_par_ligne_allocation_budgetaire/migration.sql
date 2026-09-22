-- AlterTable
ALTER TABLE "LigneDemande" ADD COLUMN     "categorieId" TEXT,
ADD COLUMN     "objetId" TEXT;

-- CreateTable
CREATE TABLE "ReglementCategorieAllocation" (
    "id" TEXT NOT NULL,
    "reglementId" TEXT NOT NULL,
    "categorieId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReglementCategorieAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReglementCategorieAllocation_reglementId_categorieId_key" ON "ReglementCategorieAllocation"("reglementId", "categorieId");

-- AddForeignKey
ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_objetId_fkey" FOREIGN KEY ("objetId") REFERENCES "Objet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglementCategorieAllocation" ADD CONSTRAINT "ReglementCategorieAllocation_reglementId_fkey" FOREIGN KEY ("reglementId") REFERENCES "Reglement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReglementCategorieAllocation" ADD CONSTRAINT "ReglementCategorieAllocation_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
