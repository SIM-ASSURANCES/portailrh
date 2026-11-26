-- FeedbackApp privé : limite « un avis par jour » et permission « feedback.voir_details ». Rejouable sans effet.

-- 1. Trace temporaire de la limite : empreinte HMAC et jour, rien d'autre (aucune relation).
CREATE TABLE IF NOT EXISTS "FeedbackQuota" (
    "cle" TEXT NOT NULL,
    "jour" DATE NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackQuota_cle_key" ON "FeedbackQuota"("cle");

-- 2. Permission « feedback.voir_details », donnée à RH et DG sur les bases existantes (jamais Admin).
-- Attribution faite UNE seule fois par cette migration, ensuite librement modifiable dans /admin/roles.
INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('feedback-module-rattrapage', 'feedback', 'FeedbackApp', true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'feedback-voir-details-permission', 'feedback.voir_details',
       'Voir les destinataires et les avis sur les conditions de travail (FeedbackApp)', m."id"
FROM "Module" m
WHERE m."key" = 'feedback'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" IN ('RH', 'DG') AND p."key" = 'feedback.voir_details'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
