-- Reinitialisation a usage unique avant mise en production (voir CLAUDE.md).
-- 1) Table de flag + journal d'audit, jamais purgee. "verrou" unique = une seule execution possible.
CREATE TABLE "ReinitialisationSysteme" (
    "id" TEXT NOT NULL,
    "verrou" TEXT NOT NULL DEFAULT 'REINITIALISATION',
    "effectueeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectueeParId" TEXT NOT NULL,
    "decompte" JSONB NOT NULL,
    "sauvegardeSha256" TEXT NOT NULL,
    "fichiersSupprimes" INTEGER NOT NULL DEFAULT 0,
    "fichiersEchecs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ReinitialisationSysteme_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReinitialisationSysteme_verrou_key" ON "ReinitialisationSysteme"("verrou");
ALTER TABLE "ReinitialisationSysteme" ADD CONSTRAINT "ReinitialisationSysteme_effectueeParId_fkey" FOREIGN KEY ("effectueeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Module technique "systeme" (masque des cartes du tableau de bord) + permission dediee, attribuee
--    au SEUL role DG (jamais Admin, jamais heritee d'estAdmin). Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('systeme-module-reinit', 'systeme', 'Système', true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'systeme-reinitialiser-permission', 'systeme.reinitialiser', 'Réinitialiser les données de test avant mise en production (usage unique)', m."id"
FROM "Module" m
WHERE m."key" = 'systeme'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" = 'DG' AND p."key" = 'systeme.reinitialiser'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
