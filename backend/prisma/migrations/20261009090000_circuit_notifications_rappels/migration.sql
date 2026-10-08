-- Circuit de validation, commit 5 (2026-10-09) : notifications à chaque étape et rappels à 48 h, calculés à la volée.
--
-- `etapeCircuitDepuis` : entrée dans l'étape courante, posée à chaque changement d'étape (`circuitDemandeDb.ts`).
-- Pour les demandes existantes, reprise de la dernière action du circuit dans l'historique, sinon de la création.
-- `dernierRappelAt` : dernier rappel envoyé (au plus un par heure et par demande). Purement additive ; rejouée, elle
-- ne recrée rien et recalcule la même date de reprise.

ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "etapeCircuitDepuis" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "dernierRappelAt" TIMESTAMP(3);

UPDATE "Demande" d
SET "etapeCircuitDepuis" = COALESCE(
  (
    SELECT MAX(h."createdAt") FROM "HistoriqueEntry" h
    WHERE h."entity" = 'Demande'
      AND h."entityId" = d."id"
      AND h."action" IN (
        'validation_service', 'renvoi_correction', 'soumission_dg', 'resoumission_dg', 'validation_dg', 'rejet_dg',
        'decision_circuit', 'resoumission_correction', 'abandon'
      )
  ),
  d."createdAt"
);
