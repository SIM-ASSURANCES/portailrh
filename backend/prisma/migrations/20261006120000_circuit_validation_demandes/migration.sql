-- Circuit de validation des demandes (commit 3, 2026-10-06). Moteur : backend/src/circuitDemande.ts.
--
-- Aucune colonne ni aucun champ de la « validation complète » du DG n'est retiré : le verrou de clôture reste
-- (validationCompleteParDG, dgApprobateurId, dgApprouveAt, validationCompleteRejeteeParDG).

-- AlterEnum : abandon par le demandeur (état terminal).
ALTER TYPE "StatutDemande" ADD VALUE 'ABANDONNEE';

-- CreateEnum
CREATE TYPE "EtapeCircuit" AS ENUM ('SERVICE', 'FINANCE', 'DG', 'REJET_DG', 'DECISION_FINALE', 'TERMINEE', 'A_CORRIGER', 'ABANDONNEE');
CREATE TYPE "ModeEtapeDG" AS ENUM ('NON_REQUISE', 'OPTIONNELLE', 'OBLIGATOIRE');
CREATE TYPE "NiveauRejet" AS ENUM ('SERVICE', 'FINANCE', 'DG');

-- AlterTable : valeur provisoire TERMINEE pour les lignes existantes, retirée plus bas (toute création choisit sa
-- première étape).
ALTER TABLE "Demande" ADD COLUMN     "approbationClotureNonRequise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "descriptionDemandeur" TEXT,
ADD COLUMN     "etapeCircuit" "EtapeCircuit" NOT NULL DEFAULT 'TERMINEE',
ADD COLUMN     "etapeFinanceRequise" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "etapeServiceRequise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modeEtapeDG" "ModeEtapeDG" NOT NULL DEFAULT 'OPTIONNELLE',
ADD COLUMN     "niveauRejet" "NiveauRejet",
ADD COLUMN     "soumiseAuDG" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tourCircuit" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Demande" ADD COLUMN     "decideurFinanceId" TEXT;
ALTER TABLE "Demande" ADD CONSTRAINT "Demande_decideurFinanceId_fkey" FOREIGN KEY ("decideurFinanceId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LigneDemande" ADD COLUMN     "libelleDemandeur" TEXT;

-- CreateIndex
CREATE INDEX "Demande_etapeCircuit_idx" ON "Demande"("etapeCircuit");

-- Demandes en cours (décision 7) : étape Finance, Service non requise (valeurs par défaut ci-dessus). « En cours » =
-- en attente de validation et aucune décision prise : sans ligne, ou avec au moins une ligne encore en attente.
-- Toutes les autres (décidées, rejetées, clôturées, ou lignes toutes rejetées) restent TERMINEE, inchangées.
UPDATE "Demande" d
SET "etapeCircuit" = 'FINANCE'
WHERE d."statut" = 'EN_ATTENTE_VALIDATION'
  AND (
    NOT EXISTS (SELECT 1 FROM "LigneDemande" l WHERE l."demandeId" = d."id")
    OR EXISTS (SELECT 1 FROM "LigneDemande" l WHERE l."demandeId" = d."id" AND l."statutValidation" = 'EN_ATTENTE')
  );

ALTER TABLE "Demande" ALTER COLUMN "etapeCircuit" DROP DEFAULT;

-- Décideur Finance des demandes déjà décidées (règle des deux personnes pour leur approbation de clôture) : auteur
-- de la décision la plus récente d'une ligne validée, sinon (demande sans ligne) auteur de la première validation
-- par montant.
UPDATE "Demande" d
SET "decideurFinanceId" = (
  SELECT l."decideParId" FROM "LigneDemande" l
  WHERE l."demandeId" = d."id" AND l."statutValidation" = 'VALIDEE' AND l."decideParId" IS NOT NULL
  ORDER BY l."decideAt" DESC LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM "LigneDemande" l
  WHERE l."demandeId" = d."id" AND l."statutValidation" = 'VALIDEE' AND l."decideParId" IS NOT NULL
);
UPDATE "Demande" d
SET "decideurFinanceId" = (
  SELECT h."userId" FROM "HistoriqueEntry" h
  WHERE h."entity" = 'Demande' AND h."entityId" = d."id" AND h."action" = 'validation'
  ORDER BY h."createdAt" ASC LIMIT 1
)
WHERE d."decideurFinanceId" IS NULL
  AND d."montantValide" > 0
  AND NOT EXISTS (SELECT 1 FROM "LigneDemande" l WHERE l."demandeId" = d."id")
  AND EXISTS (SELECT 1 FROM "HistoriqueEntry" h WHERE h."entity" = 'Demande' AND h."entityId" = d."id" AND h."action" = 'validation');

-- Permission de décision à l'étape DG, donnée aux rôles qui portent `systeme.reinitialiser` (DG seul, posée par
-- 20260925100000), jamais par nom de rôle. PAS `approuver_validation_complete` : en production, Finance et Admin la
-- portent aussi et recevraient la décision du DG. Idempotent.
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-treso-decider_dg', 'treso.decider_dg', 'Décider à l''étape DG (valider ou rejeter une demande soumise)', m."id"
FROM "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" pa ON pa."id" = rp."permissionId" AND pa."key" = 'systeme.reinitialiser'
CROSS JOIN "Permission" p
WHERE p."key" = 'treso.decider_dg'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
