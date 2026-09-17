-- Attribution de "feedback.moderer" au role "Admin" -- DECISION PRODUIT
-- DELIBEREE ET SOURCEE, confirmee par le maitre de stage le 17/09/2026,
-- documentee dans CLAUDE.md ("FeedbackApp -- notation structuree").
--
-- A NE PAS CONFONDRE avec l'incident precedent (voir migration
-- 20260918000000_feedback_moderer_role_permission_rattrapage) : la ou ce
-- role avait ete reattribue AUTOMATIQUEMENT a chaque process serveur par
-- un mecanisme runtime bugue (jamais autorise, corrige depuis), cette
-- fois l'attribution est un choix produit explicite, fait UNE SEULE FOIS
-- via cette migration ponctuelle -- jamais via un mecanisme qui
-- s'executerait a chaque demarrage. Reste ensuite librement modifiable
-- par un Admin via /admin/roles, comme n'importe quel autre role, sans
-- jamais etre reinitialisee automatiquement.
--
-- Idempotent (ON CONFLICT DO NOTHING) : sans effet si deja applique.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" = 'Admin' AND p."key" = 'feedback.moderer'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
