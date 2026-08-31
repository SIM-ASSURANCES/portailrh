-- CreateEnum
CREATE TYPE "TypeDemande" AS ENUM ('STANDARD', 'DEPENSE_DIRECTE');

-- CreateEnum
CREATE TYPE "NatureDepenseDirecte" AS ENUM ('PRIME_STAGE', 'DOTATION_CARBURANT', 'DEPENSE_ENTREPRISE', 'DEPENSE_COLLECTIVE', 'AUTRE');

-- AlterTable
ALTER TABLE "Demande" ADD COLUMN     "natureDepenseDirecte" "NatureDepenseDirecte",
ADD COLUMN     "typeDemande" "TypeDemande" NOT NULL DEFAULT 'STANDARD';
