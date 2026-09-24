-- AlterTable
ALTER TABLE "Demande" ADD COLUMN "validationCompleteRejeteeParDG" BOOLEAN NOT NULL DEFAULT false;

-- Rattrapage : une demande non approuvée dont le dernier évènement DG connu
-- est un rejet est déjà "rejetée" (le rejet n'était tracé que dans l'historique).
UPDATE "Demande" d
SET "validationCompleteRejeteeParDG" = true
WHERE d."validationCompleteParDG" = false
  AND (
    SELECT h."action" FROM "HistoriqueEntry" h
    WHERE h."entity" = 'Demande' AND h."entityId" = d."id"
      AND h."action" IN ('rejet_validation_complete','annulation_validation_complete')
    ORDER BY h."createdAt" DESC LIMIT 1
  ) = 'rejet_validation_complete';
