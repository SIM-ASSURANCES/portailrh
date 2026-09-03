-- DropForeignKey
ALTER TABLE "Demande" DROP CONSTRAINT "Demande_posteBudgetaireId_fkey";

-- AlterTable
ALTER TABLE "Demande" DROP COLUMN "budgetDisponible",
DROP COLUMN "posteBudgetaireId";

-- AlterTable
ALTER TABLE "Categorie" ADD COLUMN     "budgetAlloue" DECIMAL(14,2);
