-- Rattrapage : garantit que le Module "feedback", la Permission
-- "feedback.moderer" existent, et que RH et DG (JAMAIS Admin) la
-- possedent -- sur toute base deja seedee AVANT l'existence de FeedbackApp,
-- que seed.ts ne rejouera donc jamais (seed JAMAIS automatise en
-- production apres l'init, voir CLAUDE.md "Deploiement Docker/Dokploy").
-- Idempotent de bout en bout (ON CONFLICT DO NOTHING partout) : sans
-- effet sur une base neuve, ou seed.ts cree deja ces lignes correctement.
--
-- Remplace l'ancien mecanisme runtime `ensureFeedbackPermissions()`
-- (backend/src/feedback.ts, appele sans condition dans `getSession()` et
-- dans `admin/roles/page.tsx`) qui reattribuait AUTOMATIQUEMENT cette
-- permission a RH/DG ET Admin a CHAQUE process serveur (via upsert avec
-- update: {}) -- "Admin" n'a jamais ete autorise, et ce mecanisme
-- ecrasait silencieusement toute revocation faite par un Admin via
-- /admin/roles des le redemarrage/redeploiement suivant. Une migration,
-- elle, ne s'execute qu'UNE SEULE FOIS pour la duree de vie d'une base
-- (Prisma le garantit via la table `_prisma_migrations`), jamais a
-- nouveau au redemarrage suivant -- l'attribution initiale reste ensuite
-- librement modifiable par un Admin sans jamais etre reinitialisee.

INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('feedback-module-rattrapage', 'feedback', 'FeedbackApp', true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'feedback-moderer-permission-rattrapage', 'feedback.moderer', 'Modérer les messages FeedbackApp', m."id"
FROM "Module" m
WHERE m."key" = 'feedback'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" IN ('RH', 'DG') AND p."key" = 'feedback.moderer'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Nettoyage de la consequence du bug lui-meme : si l'ancien mecanisme a
-- deja tourne sur cette base avant ce correctif, le role "Admin" a pu
-- recevoir "feedback.moderer" automatiquement -- jamais un choix fait
-- deliberement par un Admin via /admin/roles (aucune case cochee a la
-- main pour son propre role, seulement l'effet du bug). Retire cette
-- attribution pour repartir de l'etat voulu ; un Admin qui souhaiterait
-- reellement l'accorder au role "Admin" reste libre de le refaire
-- manuellement ensuite, comme pour n'importe quel autre role.
DELETE FROM "RolePermission"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "name" = 'Admin')
  AND "permissionId" IN (SELECT "id" FROM "Permission" WHERE "key" = 'feedback.moderer');
