-- Autonomie des articles, lot B (2026-10-15) : décision Finance PAR ARTICLE. Purement additive :
--  - LigneDemande.decideurFinanceId : compte qui a décidé l'article COMME FINANCE. Sert à la règle des deux personnes
--    par article (le décideur Finance et l'approbateur DG d'une demande ne sont jamais le même compte). Distinct de
--    decideParId, qui garde l'auteur DG pour un article validé par le DG.
-- Rattrapage des articles déjà décidés (idempotent : ne touche que les lignes où la colonne est encore vide) :
--  Seuls les articles VALIDÉS comptent (comme Demande.decideurFinanceId, posé seulement à une validation : rejeter
--  n'engage pas d'argent) :
--  - validé sans passage par le DG : le décideur Finance est l'auteur de la décision (decideParId) ;
--  - validé par le DG puis confirmé par la Finance : le décideur Finance est celui de la demande (Demande.decideurFinanceId) ;
--  - demande dont le DG décide tout (cas b, modeEtapeDG = OBLIGATOIRE) : aucun décideur Finance.
-- Aucun changement sur l'énumération des statuts, les étapes (colonne etapeCircuit conservée) ni les permissions.
-- Le recalcul des statuts des demandes existantes se fait par un script lancé à la main (voir CLAUDE.md), jamais ici.

ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "decideurFinanceId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LigneDemande_decideurFinanceId_fkey') THEN
    ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_decideurFinanceId_fkey"
      FOREIGN KEY ("decideurFinanceId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LigneDemande_decideurFinanceId_idx" ON "LigneDemande"("decideurFinanceId");

UPDATE "LigneDemande" l
SET "decideurFinanceId" = CASE
  WHEN l."decisionDG" = 'VALIDEE' THEN d."decideurFinanceId"
  ELSE l."decideParId"
END
FROM "Demande" d
WHERE l."demandeId" = d."id"
  AND l."decideurFinanceId" IS NULL
  AND l."statutValidation" = 'VALIDEE'
  AND d."modeEtapeDG" <> 'OBLIGATOIRE';
