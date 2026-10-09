-- Soumission au DG ligne par ligne (2026-10-10). À l'étape Finance, la Finance choisit les lignes soumises au DG
-- (`treso.soumettre_dg`) ; le DG décide chacune (`treso.decider_dg`). La décision finale de la ligne reste
-- `statutValidation`, posée à la décision finale de la Finance. Aucune permission ni aucun rôle créé ou modifié.
-- Idempotente : rejouée, elle ne change rien. Aucune écriture de caisse touchée.

DO $$ BEGIN
  CREATE TYPE "DecisionLigneDG" AS ENUM ('VALIDEE', 'REFUSEE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "soumiseAuDG" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "soumiseDGAt" TIMESTAMP(3);
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "soumiseDGParId" TEXT;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "decisionDG" "DecisionLigneDG";
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "decisionDGAt" TIMESTAMP(3);
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "decisionDGParId" TEXT;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "motifRefusDG" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LigneDemande_soumiseDGParId_fkey') THEN
    ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_soumiseDGParId_fkey"
      FOREIGN KEY ("soumiseDGParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LigneDemande_decisionDGParId_fkey') THEN
    ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_decisionDGParId_fkey"
      FOREIGN KEY ("decisionDGParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Rattrapage des demandes déjà soumises au DG par l'ancien circuit (décision sur la demande entière), selon l'étape
-- (décision du 2026-10-10). Le cas (b), où le DG décide d'office toutes les lignes, n'est pas concerné.

-- 1. Toutes les lignes passent à « soumise » (auteur et date de la dernière soumission, si l'historique les a).
UPDATE "LigneDemande" l
SET "soumiseAuDG" = true,
    "soumiseDGAt" = COALESCE(
      (SELECT h."createdAt" FROM "HistoriqueEntry" h
        WHERE h."entity" = 'Demande' AND h."entityId" = d."id" AND h."action" IN ('soumission_dg', 'resoumission_dg')
        ORDER BY h."createdAt" DESC LIMIT 1),
      d."etapeCircuitDepuis"),
    "soumiseDGParId" = (SELECT h."userId" FROM "HistoriqueEntry" h
        WHERE h."entity" = 'Demande' AND h."entityId" = d."id" AND h."action" IN ('soumission_dg', 'resoumission_dg')
        ORDER BY h."createdAt" DESC LIMIT 1)
FROM "Demande" d
WHERE l."demandeId" = d."id" AND d."soumiseAuDG" = true AND d."modeEtapeDG" = 'OPTIONNELLE' AND l."soumiseAuDG" = false;

-- 2. Rejet DG : lignes refusées par le DG (motif du rejet), puis la demande passe à la décision finale.
UPDATE "LigneDemande" l
SET "decisionDG" = 'REFUSEE',
    "motifRefusDG" = d."motifRejet",
    "decisionDGAt" = (SELECT h."createdAt" FROM "HistoriqueEntry" h
        WHERE h."entity" = 'Demande' AND h."entityId" = d."id" AND h."action" = 'rejet_dg' ORDER BY h."createdAt" DESC LIMIT 1),
    "decisionDGParId" = (SELECT h."userId" FROM "HistoriqueEntry" h
        WHERE h."entity" = 'Demande' AND h."entityId" = d."id" AND h."action" = 'rejet_dg' ORDER BY h."createdAt" DESC LIMIT 1)
FROM "Demande" d
WHERE l."demandeId" = d."id" AND d."etapeCircuit" = 'REJET_DG' AND l."soumiseAuDG" = true AND l."decisionDG" IS NULL;

-- 3. Décision finale (le DG avait validé la demande) : lignes validées par le DG, auteur et date de son approbation.
UPDATE "LigneDemande" l
SET "decisionDG" = 'VALIDEE', "decisionDGAt" = d."dgApprouveAt", "decisionDGParId" = d."dgApprobateurId"
FROM "Demande" d
WHERE l."demandeId" = d."id" AND d."etapeCircuit" = 'DECISION_FINALE' AND d."modeEtapeDG" = 'OPTIONNELLE'
  AND l."soumiseAuDG" = true AND l."decisionDG" IS NULL;

UPDATE "Demande" d
SET "etapeCircuit" = 'DECISION_FINALE', "etapeCircuitDepuis" = CURRENT_TIMESTAMP
WHERE d."etapeCircuit" = 'REJET_DG' AND EXISTS (SELECT 1 FROM "LigneDemande" l WHERE l."demandeId" = d."id");

-- Étape DG : les lignes restent en attente du DG, qui décide chacune. Demandes terminées, à corriger ou abandonnées :
-- lignes « soumises » sans décision DG, en historique seulement.
