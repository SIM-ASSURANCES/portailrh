-- Suite de la décision 3 (2026-10-07) : Finance, Assistant Finance et DG, qui créent désormais des demandes, déclarent
-- aussi le retour de caisse de leurs propres demandes, comme tout demandeur.
--
-- `treso.declarer_retour` est donnée aux rôles qui portent une permission « sœur » — `treso.decider_finance`,
-- `treso.effectuer_reglement` ou `treso.decider_dg` —, jamais par nom de rôle. La réception de ce retour reste faite
-- par un autre compte (`refusExecutionPropreDemande`). Idempotente : rejouée, elle ne donne rien de plus.

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" ps ON ps."id" = rp."permissionId"
  AND ps."key" IN ('treso.decider_finance', 'treso.effectuer_reglement', 'treso.decider_dg')
CROSS JOIN "Permission" p
WHERE p."key" = 'treso.declarer_retour'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
