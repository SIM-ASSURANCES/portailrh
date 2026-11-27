-- Gestion Compta : la lecture de la rémunération des partenaires devient une permission propre (Q10, décision du 2026-11-27,
-- docs/compta-conception.md, registre C-36). Elle protège les écrans, exports et PDF qui montrent commissions, accessoires
-- reversés, honoraires, conventions et règlements de partenaires.
-- Rejouable : ON CONFLICT DO NOTHING partout. Attribution PAR PERMISSION SŒUR (les rôles qui règlent un partenaire ou tranchent
-- les litiges), jamais par nom de rôle. Aucune ligne existante n'est modifiée ni supprimée.

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'perm-cpt-consulter-remuneration', 'cpt.consulter_remuneration', 'Gestion Compta : voir la rémunération des partenaires', m."id"
FROM "Module" m
WHERE m."key" = 'compta'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM (VALUES
  ('cpt.consulter_remuneration', 'cpt.regler_partenaire'),
  ('cpt.consulter_remuneration', 'cpt.trancher_litige')
) AS m(nouvelle, soeur)
JOIN "Permission" np ON np."key" = m.nouvelle
JOIN "Permission" sp ON sp."key" = m.soeur
JOIN "RolePermission" rp ON rp."permissionId" = sp."id"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
