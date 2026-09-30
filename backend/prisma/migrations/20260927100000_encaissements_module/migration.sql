-- Module Encaissements : cablage (voir docs/encaissements-conception.md §4).
-- Module, permissions enc.*, 5 roles de depart et leurs permissions, enc.mettre_en_service au seul role DG.
-- Idempotente (ON CONFLICT DO NOTHING partout) : sans effet sur une base neuve ou seed.ts cree deja ces lignes ;
-- n'ecrase jamais une modification faite ensuite via /admin/roles (une migration ne s'execute qu'une fois).
-- Contenu genere depuis backend/src/encPermissions.ts ; encPermissions.test.ts verifie que les deux restent identiques.
-- Aucune permission de validation d'un versement (ambiguite 5, en attente du client).

INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('encaissements-module', 'encaissements', 'Encaissements, taxes et commissions', true)
ON CONFLICT ("key") DO NOTHING;

-- Module technique "systeme" (deja cree par 20260925100000_reinitialisation_systeme ; repris ici par securite).
INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('systeme-module-reinit', 'systeme', 'Système', true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT v.id, v.key, v.label, m."id"
FROM (VALUES
  ('perm-enc.consulter', 'enc.consulter', 'Encaissements : consulter et exporter'),
  ('perm-enc.importer_production', 'enc.importer_production', 'Encaissements : importer le fichier de production'),
  ('perm-enc.gerer_contrats', 'enc.gerer_contrats', 'Encaissements : créer et corriger les contrats (taux en saisie directe)'),
  ('perm-enc.parametrer_taux', 'enc.parametrer_taux', 'Encaissements : paramétrer les taux par produit et par partenaire'),
  ('perm-enc.annuler_contrat', 'enc.annuler_contrat', 'Encaissements : annuler un contrat (écran ou import)'),
  ('perm-enc.saisir_versement', 'enc.saisir_versement', 'Encaissements : saisir les versements'),
  ('perm-enc.saisir_remise', 'enc.saisir_remise', 'Encaissements : saisir les encaissements groupés'),
  ('perm-enc.importer_encaissements', 'enc.importer_encaissements', 'Encaissements : importer des encaissements'),
  ('perm-enc.saisir_suspens', 'enc.saisir_suspens', 'Encaissements : saisir et identifier les paiements en suspens'),
  ('perm-enc.classer_suspens', 'enc.classer_suspens', 'Encaissements : classer un suspens (non taxable, à rembourser)'),
  ('perm-enc.regler_sortant', 'enc.regler_sortant', 'Encaissements : saisir les règlements de taxes, commissions, honoraires et accessoires'),
  ('perm-enc.rapprocher', 'enc.rapprocher', 'Encaissements : rapprocher les relevés banque et mobile money'),
  ('perm-enc.corriger_versement_valide', 'enc.corriger_versement_valide', 'Encaissements : corriger un versement validé'),
  ('perm-enc.annuler_reglement', 'enc.annuler_reglement', 'Encaissements : annuler un règlement'),
  ('perm-enc.cloturer_mois', 'enc.cloturer_mois', 'Encaissements : clôturer un mois'),
  ('perm-enc.decloturer_mois', 'enc.decloturer_mois', 'Encaissements : déclôturer un mois'),
  ('perm-enc.deroger', 'enc.deroger', 'Encaissements : déroger à la liste de contrôle de clôture')
) AS v(id, key, label)
CROSS JOIN "Module" m
WHERE m."key" = 'encaissements'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'perm-enc.mettre_en_service', 'enc.mettre_en_service', 'Encaissements : mettre le module en service (remise à zéro, usage unique)', m."id"
FROM "Module" m
WHERE m."key" = 'systeme'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Role" ("id", "name", "description", "estAdmin", "peutEtreBeneficiaireDelegation", "peutRecevoirFeedback")
VALUES
  ('role-encaissements-1', 'Encaissements – Équipe technique', 'Import de la production, contrats, paramétrage des taux, annulation de contrats', false, false, true),
  ('role-encaissements-2', 'Encaissements – Gestionnaire', 'Appel d''une police, saisie des versements et des encaissements groupés, suspens', false, false, true),
  ('role-encaissements-3', 'Encaissements – Finance', 'Import de la production transmise, règlements sortants, rapprochement, suspens', false, false, true),
  ('role-encaissements-4', 'Encaissements – Responsable', 'Correction d''un versement validé, annulation d''un règlement, clôture et déclôture mensuelles', false, false, true),
  ('role-encaissements-5', 'Encaissements – Consultation', 'Consultation et export, aucune modification', false, false, true)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES
  ('Encaissements – Équipe technique', 'enc.consulter'),
  ('Encaissements – Équipe technique', 'enc.importer_production'),
  ('Encaissements – Équipe technique', 'enc.gerer_contrats'),
  ('Encaissements – Équipe technique', 'enc.parametrer_taux'),
  ('Encaissements – Équipe technique', 'enc.annuler_contrat'),
  ('Encaissements – Gestionnaire', 'enc.consulter'),
  ('Encaissements – Gestionnaire', 'enc.saisir_versement'),
  ('Encaissements – Gestionnaire', 'enc.saisir_remise'),
  ('Encaissements – Gestionnaire', 'enc.importer_encaissements'),
  ('Encaissements – Gestionnaire', 'enc.saisir_suspens'),
  ('Encaissements – Finance', 'enc.consulter'),
  ('Encaissements – Finance', 'enc.importer_production'),
  ('Encaissements – Finance', 'enc.saisir_suspens'),
  ('Encaissements – Finance', 'enc.classer_suspens'),
  ('Encaissements – Finance', 'enc.regler_sortant'),
  ('Encaissements – Finance', 'enc.rapprocher'),
  ('Encaissements – Responsable', 'enc.consulter'),
  ('Encaissements – Responsable', 'enc.corriger_versement_valide'),
  ('Encaissements – Responsable', 'enc.annuler_reglement'),
  ('Encaissements – Responsable', 'enc.cloturer_mois'),
  ('Encaissements – Responsable', 'enc.decloturer_mois'),
  ('Encaissements – Responsable', 'enc.deroger'),
  ('Encaissements – Consultation', 'enc.consulter')
) AS v(role_name, permission_key)
JOIN "Role" r ON r."name" = v.role_name
JOIN "Permission" p ON p."key" = v.permission_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" = 'DG' AND p."key" = 'enc.mettre_en_service'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
