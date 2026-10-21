-- Lot J ter (2026-10-20) : le budget GLOBAL n'est plus un montant saisi, c'est le SOLDE DE CAISSE RÉEL (journal de caisse).
-- Le paramétrage global ne porte plus que des seuils d'alerte, en MONTANT (FCFA) uniquement. Les budgets de catégorie ne
-- changent pas. Idempotente (rejouable sans effet). Aucune écriture de caisse touchée, aucune permission créée.

-- 1. Le montant devient facultatif : il reste obligatoire pour une catégorie, absent pour le global (contrainte ci-dessous).
ALTER TABLE "BudgetParametrage" ALTER COLUMN "montant" DROP NOT NULL;

-- 2. L'ancienne contrainte de cohérence (montant > 0 pour tout paramétrage) est remplacée.
ALTER TABLE "BudgetParametrage" DROP CONSTRAINT IF EXISTS "BudgetParametrage_coherence_check";

-- 3. Conversion des paramétrages GLOBAUX du lot J (statut et période conservés, rien n'est supprimé) :
--    - le montant saisi est IGNORÉ (mis à NULL) ;
--    - un seuil en MONTANT est conservé tel quel ;
--    - un seuil en POURCENTAGE (sans sens pour un solde de caisse) est remplacé par le seuil par défaut documenté :
--      orange à 100 000 FCFA, rouge à 0 FCFA (`SEUIL_CAISSE_PAR_DEFAUT`) — rien n'est bloqué au déploiement tant que la caisse n'est pas à sec ;
--    - un paramétrage sans seuil reste sans seuil : sans seuil global validé, aucune alerte globale.
--    La condition « montant IS NOT NULL » rend l'ensemble idempotent (un global déjà converti n'est pas retouché).
UPDATE "BudgetParametrage"
SET "modeSeuil" = 'MONTANT', "seuilOrange" = 100000, "seuilRouge" = 0
WHERE "portee" = 'GLOBAL' AND "montant" IS NOT NULL AND "modeSeuil" = 'POURCENTAGE';

UPDATE "BudgetParametrage"
SET "montant" = NULL
WHERE "portee" = 'GLOBAL' AND "montant" IS NOT NULL;

-- 4. Nouvelle contrainte de cohérence : catégorie = montant > 0 ; global = aucun montant, seuil absent (ancien paramétrage sans
--    alerte) ou en MONTANT ; fin ≥ début ; seuil complet ou absent avec rouge strictement plus bas que l'orange.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'BudgetParametrage_coherence_v2_check') THEN
    ALTER TABLE "BudgetParametrage" ADD CONSTRAINT "BudgetParametrage_coherence_v2_check" CHECK (
      (
        ("portee" = 'CATEGORIE' AND "categorieId" IS NOT NULL AND "montant" IS NOT NULL AND "montant" > 0)
        OR ("portee" = 'GLOBAL' AND "categorieId" IS NULL AND "montant" IS NULL AND ("modeSeuil" IS NULL OR "modeSeuil" = 'MONTANT'))
      )
      AND ("dateFin" IS NULL OR "dateFin" >= "dateDebut")
      AND (
        ("modeSeuil" IS NULL AND "seuilOrange" IS NULL AND "seuilRouge" IS NULL)
        OR ("modeSeuil" IS NOT NULL AND "seuilOrange" IS NOT NULL AND "seuilRouge" IS NOT NULL
            AND "seuilRouge" >= 0 AND "seuilRouge" < "seuilOrange")
      )
    );
  END IF;
END $$;
