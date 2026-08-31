-- AlterTable
ALTER TABLE "Demande" ADD COLUMN     "dateLivraisonSouhaitee" TIMESTAMP(3),
ADD COLUMN     "devise" TEXT NOT NULL DEFAULT 'XOF',
ADD COLUMN     "posteBudgetaireId" TEXT;

-- CreateTable
CREATE TABLE "LigneDemande" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "prixUnitaire" DECIMAL(14,2) NOT NULL,
    "demandeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LigneDemande_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Demande" ADD CONSTRAINT "Demande_posteBudgetaireId_fkey" FOREIGN KEY ("posteBudgetaireId") REFERENCES "Categorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
