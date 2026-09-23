-- AlterTable
ALTER TABLE "RetourCaisse" ADD COLUMN     "creeParAssistant" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motifReouvertureExceptionnelle" TEXT;
