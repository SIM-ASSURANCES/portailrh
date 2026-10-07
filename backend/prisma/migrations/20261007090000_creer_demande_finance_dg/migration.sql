-- Décision 3 du circuit de validation (2026-10-07) : Finance, Assistant Finance et DG créent aussi des demandes.
--
-- `treso.creer_demande` est donnée aux rôles qui portent une permission « sœur » — décider à l'étape Finance
-- (`treso.decider_finance`), effectuer un règlement (`treso.effectuer_reglement`) ou décider à l'étape DG
-- (`treso.decider_dg`) —, jamais par nom de rôle. Ce que deviennent leurs demandes est fixé par le moteur du circuit
-- (cas a et b) ; personne n'exécute l'argent de sa propre demande (`refusExecutionPropreDemande`). Idempotente :
-- rejouée, elle ne donne rien de plus.

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" ps ON ps."id" = rp."permissionId"
  AND ps."key" IN ('treso.decider_finance', 'treso.effectuer_reglement', 'treso.decider_dg')
CROSS JOIN "Permission" p
WHERE p."key" = 'treso.creer_demande'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
