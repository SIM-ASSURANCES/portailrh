-- Gestion Compta, lot GC-6b : réservation des paliers du contrôle hebdomadaire (relance 7 j, alerte 30 j, escalade 60 j).
-- La contrainte d'unicité (objet, objetId, palier) est le verrou d'idempotence : un palier se réserve une seule fois, avant tout envoi.

-- CreateEnum
CREATE TYPE "CptObjetControle" AS ENUM ('ENCAISSEMENT', 'CONTRAT');

-- CreateEnum
CREATE TYPE "CptPalierControle" AS ENUM ('RELANCE', 'ALERTE', 'ESCALADE');

-- CreateTable
CREATE TABLE "CptAlerteControle" (
    "id" TEXT NOT NULL,
    "objet" "CptObjetControle" NOT NULL,
    "objetId" TEXT NOT NULL,
    "palier" "CptPalierControle" NOT NULL,
    "envoyeeAt" TIMESTAMP(3),
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptAlerteControle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CptAlerteControle_objet_palier_idx" ON "CptAlerteControle"("objet", "palier");

-- CreateIndex
CREATE UNIQUE INDEX "CptAlerteControle_objet_objetId_palier_key" ON "CptAlerteControle"("objet", "objetId", "palier");
