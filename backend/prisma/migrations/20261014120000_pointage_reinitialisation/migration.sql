-- Réinitialisation du Pointage seul, avant sa mise en service (2026-10-14). Rejouable.
-- 1) Journal d'audit PERMANENT des purges et marqueur définitif de mise en service (jamais purgés).
CREATE TABLE IF NOT EXISTS "ReinitialisationPointage" (
    "id" TEXT NOT NULL,
    "effectueeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectueeParId" TEXT NOT NULL,
    "decompte" JSONB NOT NULL,
    "sauvegardeSha256" TEXT NOT NULL,

    CONSTRAINT "ReinitialisationPointage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PointageMiseEnService" (
    "id" TEXT NOT NULL,
    "verrou" TEXT NOT NULL DEFAULT 'MISE_EN_SERVICE',
    "misEnServiceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parId" TEXT NOT NULL,

    CONSTRAINT "PointageMiseEnService_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PointageMiseEnService_verrou_key" ON "PointageMiseEnService"("verrou");

DO $$ BEGIN
  ALTER TABLE "ReinitialisationPointage" ADD CONSTRAINT "ReinitialisationPointage_effectueeParId_fkey"
    FOREIGN KEY ("effectueeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PointageMiseEnService" ADD CONSTRAINT "PointageMiseEnService_parId_fkey"
    FOREIGN KEY ("parId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Permission dédiée, rattachée au module Pointage (s'il existe : sur une base neuve, le seed la crée), attribuée
--    explicitement (une RolePermission, jamais via le contournement estAdmin) aux rôles qui portent estAdmin.
--    Retirable ensuite dans /admin/roles. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'pointage-reinitialiser-permission', 'pointage.reinitialiser', 'Réinitialiser les données du Pointage avant sa mise en service', m."id"
FROM "Module" m
WHERE m."key" = 'pointage'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."estAdmin" = true AND p."key" = 'pointage.reinitialiser'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
