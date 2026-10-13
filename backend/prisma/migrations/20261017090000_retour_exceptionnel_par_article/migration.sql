-- Autonomie des articles, lot E (2026-10-17) : retour exceptionnel post-clôture PAR ARTICLE. Purement additive :
--  - RetourExceptionnel.ligneDemandeId : l'article dont l'argent est rendu après la clôture.
--  - clé étrangère RESTRICT et index.
-- Rattrapage des retours existants (idempotent : ne touche que les retours encore sans article) :
--  - demande dont UN SEUL article est validé : ses retours exceptionnels sont rattachés à cet article — aucun doute ;
--  - demande avec deux articles validés ou plus : AUCUN rattachement automatique (on ne devine pas quel article a rendu
--    l'argent). Le retour reste sans article, signalé « non rattaché » à l'écran, et jamais compté sur un article ;
--  - demande sans article (dépense directe) : inchangée.
-- Aucune écriture de caisse (JournalCaisse) n'est touchée.

ALTER TABLE "RetourExceptionnel" ADD COLUMN IF NOT EXISTS "ligneDemandeId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RetourExceptionnel_ligneDemandeId_fkey') THEN
    ALTER TABLE "RetourExceptionnel" ADD CONSTRAINT "RetourExceptionnel_ligneDemandeId_fkey"
      FOREIGN KEY ("ligneDemandeId") REFERENCES "LigneDemande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RetourExceptionnel_ligneDemandeId_idx" ON "RetourExceptionnel"("ligneDemandeId");

UPDATE "RetourExceptionnel" e
SET "ligneDemandeId" = u."ligneId"
FROM (
  SELECT l."demandeId", MIN(l."id") AS "ligneId"
  FROM "LigneDemande" l
  WHERE l."statutValidation" = 'VALIDEE'
  GROUP BY l."demandeId"
  HAVING COUNT(*) = 1
) u
WHERE e."demandeId" = u."demandeId"
  AND e."ligneDemandeId" IS NULL;
