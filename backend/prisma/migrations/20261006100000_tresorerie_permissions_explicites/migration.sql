-- Trésorerie : permissions explicites à la place de la règle « Resp » (2026-10-06).
--
-- « Resp » = un rôle qui a `treso.valider_demande` ET n'a PAS `treso.approuver_validation_complete` : une déduction
-- fragile (un rôle qui reçoit aussi la permission du DG perd en silence toutes ces actions). Chaque action gardée par
-- cette règle reçoit sa propre permission. AUCUN DROIT PERDU : chaque permission est accordée aux rôles qui remplissent
-- la règle AU MOMENT de la migration, calculée ici en SQL (jamais un nom de rôle en dur) ; `modifier_description`
-- reprend la garde « Resp OU treso.effectuer_reglement ». Idempotente (ON CONFLICT DO NOTHING).

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-' || replace(v.cle, '.', '-'), v.cle, v.libelle, m."id"
FROM (VALUES
  ('treso.decider_finance', 'Décider à l''étape Finance (valider ou rejeter les lignes)'),
  ('treso.soumettre_dg', 'Soumettre ou resoumettre une demande au DG'),
  ('treso.annuler_reglement', 'Annuler un règlement confirmé'),
  ('treso.ajuster_retour', 'Ajuster le total déclaré d''un retour de caisse'),
  ('treso.valider_remboursement', 'Valider ou rejeter un remboursement de retour'),
  ('treso.valider_retour_exceptionnel', 'Valider ou rejeter un retour exceptionnel post-clôture'),
  ('treso.creer_retour_externe', 'Enregistrer un retour externe (hors demande)'),
  ('treso.modifier_budget_categorie', 'Modifier le budget d''une catégorie'),
  ('treso.deleguer_acces', 'Déléguer des accès'),
  ('treso.modifier_description', 'Modifier la description d''une demande et le libellé de ses lignes')
) AS v(cle, libelle), "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

-- Rôles qui remplissent « Resp » aujourd'hui.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE p."key" IN (
    'treso.decider_finance', 'treso.soumettre_dg', 'treso.annuler_reglement', 'treso.ajuster_retour',
    'treso.valider_remboursement', 'treso.valider_retour_exceptionnel', 'treso.creer_retour_externe',
    'treso.modifier_budget_categorie', 'treso.deleguer_acces', 'treso.modifier_description'
  )
  AND EXISTS (
    SELECT 1 FROM "RolePermission" rp JOIN "Permission" pv ON pv."id" = rp."permissionId"
    WHERE rp."roleId" = r."id" AND pv."key" = 'treso.valider_demande'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp JOIN "Permission" pa ON pa."id" = rp."permissionId"
    WHERE rp."roleId" = r."id" AND pa."key" = 'treso.approuver_validation_complete'
  )
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Description et libellés : la garde actuelle est « Resp OU treso.effectuer_reglement ».
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "RolePermission" rp
JOIN "Permission" pe ON pe."id" = rp."permissionId" AND pe."key" = 'treso.effectuer_reglement'
CROSS JOIN "Permission" p
WHERE p."key" = 'treso.modifier_description'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
