-- CreateEnum
CREATE TYPE "SourceAbsenceAutorisee" AS ENUM ('PERMISSION', 'CONGE');

-- AlterTable
ALTER TABLE "HistoriqueEntry" ADD COLUMN     "ipAddress" TEXT;

-- AlterTable
ALTER TABLE "Pointage" ADD COLUMN     "estDepartAnticipe" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "lien" TEXT,
    "estLue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlageAbsenceAutorisee" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "heureDebut" TEXT NOT NULL,
    "heureFin" TEXT NOT NULL,
    "source" "SourceAbsenceAutorisee" NOT NULL,
    "description" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlageAbsenceAutorisee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlageAbsenceAutorisee_userId_date_idx" ON "PlageAbsenceAutorisee"("userId", "date");

-- CreateIndex
CREATE INDEX "Absence_userId_date_idx" ON "Absence"("userId", "date");

-- CreateIndex
CREATE INDEX "Demande_createurId_idx" ON "Demande"("createurId");

-- CreateIndex
CREATE INDEX "Demande_statut_idx" ON "Demande"("statut");

-- CreateIndex
CREATE INDEX "Demande_beneficiaireUserId_idx" ON "Demande"("beneficiaireUserId");

-- CreateIndex
CREATE INDEX "Pointage_userId_heure_idx" ON "Pointage"("userId", "heure");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlageAbsenceAutorisee" ADD CONSTRAINT "PlageAbsenceAutorisee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
