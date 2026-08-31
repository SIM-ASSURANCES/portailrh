/*
  Warnings:

  - The values [EN_ATTENTE,CLOTUREE_TOTALE,CLOTUREE_PARTIELLE] on the enum `StatutDemande` will be removed. If these variants are still used in the database, this will fail.
  - Added the required column `beneficiaireType` to the `Demande` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BeneficiaireType" AS ENUM ('COLLABORATEUR', 'STAGIAIRE', 'FOURNISSEUR', 'ENTREPRISE');

-- AlterEnum
BEGIN;
CREATE TYPE "StatutDemande_new" AS ENUM ('BROUILLON', 'EN_ATTENTE_VALIDATION', 'VALIDEE', 'PARTIELLEMENT_VALIDEE', 'VALIDEE_NON_REGLEE', 'PARTIELLEMENT_REGLEE', 'REGLEE', 'REJETEE', 'EN_ATTENTE_REGULARISATION', 'REGULARISEE', 'CLOTUREE');
ALTER TABLE "public"."Demande" ALTER COLUMN "statut" DROP DEFAULT;
ALTER TABLE "Demande" ALTER COLUMN "statut" TYPE "StatutDemande_new" USING ("statut"::text::"StatutDemande_new");
ALTER TYPE "StatutDemande" RENAME TO "StatutDemande_old";
ALTER TYPE "StatutDemande_new" RENAME TO "StatutDemande";
DROP TYPE "public"."StatutDemande_old";
ALTER TABLE "Demande" ALTER COLUMN "statut" SET DEFAULT 'EN_ATTENTE_VALIDATION';
COMMIT;

-- AlterTable
ALTER TABLE "Demande" ADD COLUMN     "beneficiaireNom" TEXT,
ADD COLUMN     "beneficiaireType" "BeneficiaireType" NOT NULL,
ADD COLUMN     "beneficiaireUserId" TEXT,
ADD COLUMN     "montantValide" DECIMAL(14,2),
ALTER COLUMN "statut" SET DEFAULT 'EN_ATTENTE_VALIDATION';

-- AddForeignKey
ALTER TABLE "Demande" ADD CONSTRAINT "Demande_beneficiaireUserId_fkey" FOREIGN KEY ("beneficiaireUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
