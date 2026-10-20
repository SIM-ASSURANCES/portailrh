-- Lot K (2026-10-26) — réorientation de l'étape Service vers un autre responsable disponible.
-- Écrite à la main, idempotente (rejouable sans effet). Aucune donnée existante n'est modifiée : toutes les demandes gardent
-- `responsableEtapeServiceId` à NULL, c'est-à-dire le responsable ACTUEL de leur service (règle d'origine).

ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "responsableEtapeServiceId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Demande_responsableEtapeServiceId_fkey') THEN
    ALTER TABLE "Demande"
      ADD CONSTRAINT "Demande_responsableEtapeServiceId_fkey"
      FOREIGN KEY ("responsableEtapeServiceId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Demande_responsableEtapeServiceId_idx" ON "Demande"("responsableEtapeServiceId");

-- Permission `treso.reorienter_demande` : la Finance réoriente l'étape Service d'une demande qui n'est pas la sienne (le
-- demandeur réoriente la sienne sans permission). Donnée aux rôles qui portent `treso.decider_finance` (jamais un nom de
-- rôle). N'est PAS une permission de décision : `PERMISSIONS_DECISION_NON_DELEGABLES` reste inchangée. Idempotent ; à
-- ajuster ensuite dans /admin/roles.
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-treso-reorienter_demande', 'treso.reorienter_demande', 'Réorienter l''étape Service d''une demande vers un autre responsable', m."id"
FROM "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" pa ON pa."id" = rp."permissionId" AND pa."key" = 'treso.decider_finance'
CROSS JOIN "Permission" p
WHERE p."key" = 'treso.reorienter_demande'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
