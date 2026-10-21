-- Autonomie des articles, lot C (2026-10-20) : clôture FORCÉE d'une demande (articles non régularisés), avec motif.
-- Purement additive et idempotente. Aucune écriture de caisse, aucune permission, aucun changement de statut :
--  - Demande.clotureForcee / clotureForceeAt / clotureForceeParId : qui a forcé la clôture, quand ;
--  - Demande.clotureForceeArticles : instantané JSON des articles non terminés (libellé, bénéficiaire, montants, solde restant).
-- Le motif reste dans Demande.motifCloture. Aucune donnée existante n'est modifiée ici : le rattrapage des demandes déjà
-- clôturées se fait par un script lancé à la main (backend/prisma/simuler-cloture-articles.ts), jamais dans une migration.

ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "clotureForcee" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "clotureForceeAt" TIMESTAMP(3);
ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "clotureForceeParId" TEXT;
ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "clotureForceeArticles" JSONB;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Demande_clotureForceeParId_fkey') THEN
    ALTER TABLE "Demande" ADD CONSTRAINT "Demande_clotureForceeParId_fkey"
      FOREIGN KEY ("clotureForceeParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
