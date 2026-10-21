-- Lot J (2026-10-19) : budgets paramétrés par la Finance, validés par le DG, avec date d'effet et seuils d'alerte.
-- Additive et idempotente (rejouable sans effet). Aucune écriture de caisse touchée.

DO $$ BEGIN
  CREATE TYPE "PorteeBudget" AS ENUM ('GLOBAL', 'CATEGORIE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "ModeSeuilBudget" AS ENUM ('POURCENTAGE', 'MONTANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "StatutParametrageBudget" AS ENUM ('EN_ATTENTE', 'VALIDE', 'REFUSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "StatutDepassementBudget" AS ENUM ('DEMANDE', 'CONFIRME', 'UTILISE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "BudgetParametrage" (
    "id" TEXT NOT NULL,
    "portee" "PorteeBudget" NOT NULL,
    "categorieId" TEXT,
    "montant" DECIMAL(14,2) NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE,
    "modeSeuil" "ModeSeuilBudget",
    "seuilOrange" DECIMAL(14,2),
    "seuilRouge" DECIMAL(14,2),
    "statut" "StatutParametrageBudget" NOT NULL DEFAULT 'EN_ATTENTE',
    "repris" BOOLEAN NOT NULL DEFAULT false,
    "soumisParId" TEXT,
    "soumisAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decideParId" TEXT,
    "decideAt" TIMESTAMP(3),
    "motifRefus" TEXT,

    CONSTRAINT "BudgetParametrage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BudgetDepassement" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "statut" "StatutDepassementBudget" NOT NULL,
    "resume" TEXT NOT NULL,
    "demandeParId" TEXT NOT NULL,
    "demandeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmeParId" TEXT,
    "confirmeAt" TIMESTAMP(3),
    "motif" TEXT,
    "utiliseAt" TIMESTAMP(3),

    CONSTRAINT "BudgetDepassement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BudgetParametrage_portee_categorieId_statut_idx" ON "BudgetParametrage"("portee", "categorieId", "statut");
CREATE INDEX IF NOT EXISTS "BudgetParametrage_statut_soumisAt_idx" ON "BudgetParametrage"("statut", "soumisAt");
CREATE INDEX IF NOT EXISTS "BudgetDepassement_demandeId_statut_idx" ON "BudgetDepassement"("demandeId", "statut");
CREATE INDEX IF NOT EXISTS "BudgetDepassement_statut_demandeAt_idx" ON "BudgetDepassement"("statut", "demandeAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetParametrage_categorieId_fkey') THEN
    ALTER TABLE "BudgetParametrage" ADD CONSTRAINT "BudgetParametrage_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetParametrage_soumisParId_fkey') THEN
    ALTER TABLE "BudgetParametrage" ADD CONSTRAINT "BudgetParametrage_soumisParId_fkey" FOREIGN KEY ("soumisParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetParametrage_decideParId_fkey') THEN
    ALTER TABLE "BudgetParametrage" ADD CONSTRAINT "BudgetParametrage_decideParId_fkey" FOREIGN KEY ("decideParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetDepassement_demandeId_fkey') THEN
    ALTER TABLE "BudgetDepassement" ADD CONSTRAINT "BudgetDepassement_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetDepassement_demandeParId_fkey') THEN
    ALTER TABLE "BudgetDepassement" ADD CONSTRAINT "BudgetDepassement_demandeParId_fkey" FOREIGN KEY ("demandeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetDepassement_confirmeParId_fkey') THEN
    ALTER TABLE "BudgetDepassement" ADD CONSTRAINT "BudgetDepassement_confirmeParId_fkey" FOREIGN KEY ("confirmeParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Photo du budget après la validation d'un article (parcours de l'article, reporting).
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "budgetApresValidation" JSONB;

-- Cohérence en base (en plus du contrôle applicatif de `backend/src/budgets.ts`) : portée/catégorie, montant positif,
-- fin ≥ début, seuil complet ou absent avec rouge strictement plus bas que l'orange.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetParametrage_coherence_check') THEN
    ALTER TABLE "BudgetParametrage" ADD CONSTRAINT "BudgetParametrage_coherence_check" CHECK (
      "montant" > 0
      AND (("portee" = 'GLOBAL' AND "categorieId" IS NULL) OR ("portee" = 'CATEGORIE' AND "categorieId" IS NOT NULL))
      AND ("dateFin" IS NULL OR "dateFin" >= "dateDebut")
      AND (
        ("modeSeuil" IS NULL AND "seuilOrange" IS NULL AND "seuilRouge" IS NULL)
        OR ("modeSeuil" IS NOT NULL AND "seuilOrange" IS NOT NULL AND "seuilRouge" IS NOT NULL
            AND "seuilRouge" >= 0 AND "seuilRouge" < "seuilOrange")
      )
    );
  END IF;
END $$;

-- Budgets EXISTANTS repris : chaque `Categorie.budgetAlloue` non nul devient un paramétrage VALIDÉ par le DG (sans auteur ni
-- décideur : `repris`), début 2000-01-01 (toute la consommation passée reste comptée, comportement inchangé), sans date de
-- fin, seuil par défaut = pourcentage restant, orange 20, rouge 0 (rouge seulement à l'épuisement : rien n'est bloqué au
-- déploiement tant qu'un budget n'est pas épuisé). Le budget global n'existait pas : aucun paramétrage global n'est créé.
-- Idempotent : une catégorie déjà reprise n'est pas reprise une seconde fois.
INSERT INTO "BudgetParametrage" ("id", "portee", "categorieId", "montant", "dateDebut", "dateFin", "modeSeuil", "seuilOrange", "seuilRouge", "statut", "repris", "decideAt")
SELECT 'budget-repris-' || c."id", 'CATEGORIE', c."id", c."budgetAlloue", DATE '2000-01-01', NULL, 'POURCENTAGE', 20, 0, 'VALIDE', true, CURRENT_TIMESTAMP
FROM "Categorie" c
WHERE c."budgetAlloue" IS NOT NULL AND c."budgetAlloue" > 0
ON CONFLICT ("id") DO NOTHING;

-- Permission `treso.valider_budget` : le DG valide ou refuse les paramétrages de budget. Donnée aux rôles qui portent
-- `treso.decider_dg` (le DG seul, jamais un nom de rôle). Le paramétrage par la Finance réutilise la permission existante
-- `treso.modifier_budget_categorie`. Idempotent. À attribuer ensuite à volonté dans /admin/roles.
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-treso-valider_budget', 'treso.valider_budget', 'Valider ou refuser un paramétrage de budget (DG)', m."id"
FROM "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" pa ON pa."id" = rp."permissionId" AND pa."key" = 'treso.decider_dg'
CROSS JOIN "Permission" p
WHERE p."key" = 'treso.valider_budget'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
