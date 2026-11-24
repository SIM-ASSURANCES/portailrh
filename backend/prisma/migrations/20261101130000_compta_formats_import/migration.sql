-- Gestion Compta, lot GC-1f : formats d'import paramétrables (docs/compta-conception.md §5.3 et §7).
-- Aucune donnée posée : les formats de départ arrivent avec les écrans de paramétrage (GC-2) et le premier import (GC-3).

CREATE TYPE "CptTypeImport" AS ENUM (
  'PRODUCTION',
  'RELEVE_WAVE_BUSINESS',
  'RELEVE_WAVE_HORS_BUSINESS',
  'RELEVE_BANQUE',
  'RELEVE_MICROFINANCE',
  'RELEVE_PEYAPAY',
  'BORDEREAU_PARTENAIRE'
);

CREATE TABLE "CptFormatImport" (
  "id" TEXT NOT NULL,
  "type" "CptTypeImport" NOT NULL,
  "nom" TEXT NOT NULL,
  "ligneEntete" INTEGER NOT NULL DEFAULT 1,
  "colonnes" JSONB NOT NULL,
  "parDefaut" BOOLEAN NOT NULL DEFAULT false,
  "actif" BOOLEAN NOT NULL DEFAULT true,
  "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "majAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CptFormatImport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CptFormatImport_type_nom_key" ON "CptFormatImport"("type", "nom");

-- Ajouts manuels (non modélisés par Prisma) -------------------------------------------------------------------------

-- Garde-fous de forme : la validation fine (champs, types, formats de date) est faite par backend/src/cptFormatImport.ts ;
-- la base refuse au moins ce qui ne peut jamais être valide.
ALTER TABLE "CptFormatImport"
  ADD CONSTRAINT "CptFormatImport_ligne_entete_check" CHECK ("ligneEntete" BETWEEN 1 AND 50);
ALTER TABLE "CptFormatImport"
  ADD CONSTRAINT "CptFormatImport_colonnes_tableau_check"
  CHECK (jsonb_typeof("colonnes") = 'array' AND jsonb_array_length("colonnes") > 0);

-- Un seul format par défaut par type : c'est lui que l'import propose d'office.
CREATE UNIQUE INDEX "CptFormatImport_un_defaut_par_type" ON "CptFormatImport"("type") WHERE "parDefaut";
