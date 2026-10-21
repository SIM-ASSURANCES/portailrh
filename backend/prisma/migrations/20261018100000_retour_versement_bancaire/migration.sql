-- Lot G (2026-10-14) : un retour sur un fonds versé par banque est désormais rendu en espèces à la caisse. Les anciens retours
-- Banque (versement bancaire avec bordereau, écrits dans "JournalBanque") sont marqués ici et gardent leur traitement :
-- aucune écriture déjà passée n'est modifiée. Idempotente.
ALTER TABLE "RetourCaisse" ADD COLUMN IF NOT EXISTS "versementBancaire" BOOLEAN NOT NULL DEFAULT false;

UPDATE "RetourCaisse" r
SET "versementBancaire" = true
WHERE r."versementBancaire" = false
  AND EXISTS (SELECT 1 FROM "JournalBanque" j WHERE j."retourCaisseId" = r."id" AND j."type" = 'RETOUR');
