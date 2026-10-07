-- Décision 10 du circuit de validation (2026-10-08) : le DG ne valide plus les demandes comme la Finance. Il décide à
-- l'étape DG (`treso.decider_dg`) et approuve la clôture (`treso.approuver_validation_complete`) ; ses accès de
-- consultation (tableau de bord, reporting, toutes les demandes, retours) passent par `treso.voir_dashboard_finance`.
--
-- `treso.valider_demande` est retirée des rôles qui portent `treso.decider_dg` SANS `treso.decider_finance` — jamais
-- par nom de rôle. Un rôle qui décide aussi comme Finance la garde. Idempotente : rejouée, elle ne retire rien de plus.
-- Une délégation de `treso.valider_demande` accordée par un tel rôle cesse d'être comptée (calcul dynamique de
-- `getSession`) ; la ligne de délégation reste en base.

DELETE FROM "RolePermission" rp
USING "Permission" p
WHERE rp."permissionId" = p."id"
  AND p."key" = 'treso.valider_demande'
  AND EXISTS (
    SELECT 1 FROM "RolePermission" x JOIN "Permission" px ON px."id" = x."permissionId"
    WHERE x."roleId" = rp."roleId" AND px."key" = 'treso.decider_dg'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" y JOIN "Permission" py ON py."id" = y."permissionId"
    WHERE y."roleId" = rp."roleId" AND py."key" = 'treso.decider_finance'
  );
