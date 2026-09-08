-- AlterTable
ALTER TABLE "Demande" ADD COLUMN     "motifRejetReliquat" TEXT,
ADD COLUMN     "reliquatRejete" BOOLEAN NOT NULL DEFAULT false;
