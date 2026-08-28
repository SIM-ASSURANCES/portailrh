-- CreateEnum
CREATE TYPE "TypePointage" AS ENUM ('ARRIVEE', 'DEPART');

-- CreateEnum
CREATE TYPE "SourcePointage" AS ENUM ('QR_CODE', 'ORDINATEUR', 'RH_EXCEPTIONNEL');

-- CreateEnum
CREATE TYPE "StatutAbsence" AS ENUM ('A_CONTROLER', 'CONFIRMEE', 'JUSTIFIEE');

-- CreateTable
CREATE TABLE "ParametrageHoraire" (
    "id" TEXT NOT NULL,
    "heureDebutMatin" TEXT NOT NULL,
    "heureFinMatin" TEXT NOT NULL,
    "heureDebutApresMidi" TEXT NOT NULL,
    "heureFinApresMidi" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametrageHoraire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pointage" (
    "id" TEXT NOT NULL,
    "type" "TypePointage" NOT NULL,
    "source" "SourcePointage" NOT NULL,
    "heure" TIMESTAMP(3) NOT NULL,
    "estRetard" BOOLEAN NOT NULL DEFAULT false,
    "minutesRetard" INTEGER,
    "motif" TEXT,
    "userId" TEXT NOT NULL,
    "effectueParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pointage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionPointage" (
    "id" TEXT NOT NULL,
    "ancienneValeur" TEXT NOT NULL,
    "nouvelleValeur" TEXT NOT NULL,
    "motif" TEXT NOT NULL,
    "pointageId" TEXT NOT NULL,
    "effectueParId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionPointage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "statut" "StatutAbsence" NOT NULL DEFAULT 'A_CONTROLER',
    "motif" TEXT,
    "userId" TEXT NOT NULL,
    "controleParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_effectueParId_fkey" FOREIGN KEY ("effectueParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionPointage" ADD CONSTRAINT "CorrectionPointage_pointageId_fkey" FOREIGN KEY ("pointageId") REFERENCES "Pointage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionPointage" ADD CONSTRAINT "CorrectionPointage_effectueParId_fkey" FOREIGN KEY ("effectueParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_controleParId_fkey" FOREIGN KEY ("controleParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
