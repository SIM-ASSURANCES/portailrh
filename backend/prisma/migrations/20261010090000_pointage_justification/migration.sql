-- Pointage V2 (2026-10-08) : pointage automatique sans motif, justification demandée après coup, relances et
-- décision du responsable de service (ou de la RH).
--
-- Purement additive. Les pointages existants ne reçoivent AUCUNE justification : leur motif a déjà été saisi au
-- pointage (ancien parcours), il reste dans "Pointage"."motif" et aucune relance ne partira pour eux.

-- ParametrageHoraire : tolérance et rythme des demandes de justification (paramétrables par la RH).
ALTER TABLE "ParametrageHoraire" ADD COLUMN IF NOT EXISTS "toleranceRetardMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "ParametrageHoraire" ADD COLUMN IF NOT EXISTS "delaiDemandeJustificationMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "ParametrageHoraire" ADD COLUMN IF NOT EXISTS "intervalleRelanceJustificationMinutes" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "ParametrageHoraire" ADD COLUMN IF NOT EXISTS "nombreMaxRelancesJustification" INTEGER NOT NULL DEFAULT 3;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StatutJustificationPointage" AS ENUM ('EN_ATTENTE', 'SOUMISE', 'ACCEPTEE', 'REFUSEE', 'NON_JUSTIFIEE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "JustificationPointage" (
    "id" TEXT NOT NULL,
    "statut" "StatutJustificationPointage" NOT NULL DEFAULT 'EN_ATTENTE',
    "motif" TEXT,
    "soumiseAt" TIMESTAMP(3),
    "nombreEnvois" INTEGER NOT NULL DEFAULT 0,
    "dernierEnvoiAt" TIMESTAMP(3),
    "clotureeAt" TIMESTAMP(3),
    "decideurId" TEXT,
    "decisionAt" TIMESTAMP(3),
    "motifRefus" TEXT,
    "pointageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JustificationPointage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JustificationPointage_pointageId_key" ON "JustificationPointage"("pointageId");
CREATE INDEX IF NOT EXISTS "JustificationPointage_statut_idx" ON "JustificationPointage"("statut");

-- AddForeignKey : le décideur en RESTRICT (un compte qui a décidé une justification se désactive, il ne se supprime
-- pas) ; le pointage en CASCADE (la justification n'existe pas sans son pointage).
DO $$ BEGIN
  ALTER TABLE "JustificationPointage" ADD CONSTRAINT "JustificationPointage_decideurId_fkey"
    FOREIGN KEY ("decideurId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "JustificationPointage" ADD CONSTRAINT "JustificationPointage_pointageId_fkey"
    FOREIGN KEY ("pointageId") REFERENCES "Pointage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
