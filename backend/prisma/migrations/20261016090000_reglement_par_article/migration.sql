-- Autonomie des articles, lot D (2026-10-16) : règlement PAR ARTICLE. Purement additive :
--  - Reglement.ligneDemandeId : l'article réglé (un règlement = un article). Vide pour une demande sans article
--    (dépense directe) et pour un règlement antérieur non rattaché (cas ambigu, voir ci-dessous).
--  - clé étrangère RESTRICT (un article réglé ne disparaît pas sans son règlement) et index.
-- Rattrapage des règlements existants (idempotent : ne touche que les règlements encore sans article) :
--  - demande dont UN SEUL article est validé : tous ses règlements (confirmés, brouillons, annulés) sont rattachés à cet
--    article — c'est lui qui a été payé, aucun doute possible ;
--  - demande avec deux articles validés ou plus et au moins un règlement : AUCUN rattachement automatique (on ne devine
--    pas quel article un règlement a payé). Le règlement reste sans article ; l'application bloque alors tout nouveau
--    règlement de cette demande et le signale. Le rattachement se fait à la main avec
--    `backend/prisma/recalculer-reglements-articles.ts` (simulation par défaut, `--affecter`).
--  - demande sans article : inchangée.
-- Aucune écriture de caisse (JournalCaisse, JournalBanque) n'est touchée.

ALTER TABLE "Reglement" ADD COLUMN IF NOT EXISTS "ligneDemandeId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reglement_ligneDemandeId_fkey') THEN
    ALTER TABLE "Reglement" ADD CONSTRAINT "Reglement_ligneDemandeId_fkey"
      FOREIGN KEY ("ligneDemandeId") REFERENCES "LigneDemande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Reglement_ligneDemandeId_idx" ON "Reglement"("ligneDemandeId");

UPDATE "Reglement" r
SET "ligneDemandeId" = u."ligneId"
FROM (
  SELECT l."demandeId", MIN(l."id") AS "ligneId"
  FROM "LigneDemande" l
  WHERE l."statutValidation" = 'VALIDEE'
  GROUP BY l."demandeId"
  HAVING COUNT(*) = 1
) u
WHERE r."demandeId" = u."demandeId"
  AND r."ligneDemandeId" IS NULL;
