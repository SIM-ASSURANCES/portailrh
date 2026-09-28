-- Migration corrective : permissions Encaissements V2.6 (3 profils, voir docs/encaissements-conception.md §4).
-- Ne modifie JAMAIS la migration 20260927100000_encaissements_module (deja poussee) : celle-ci la complete.
-- Idempotente (ON CONFLICT DO NOTHING / UPDATE.../ DELETE sans effet si deja applique) : rejouable sans risque.
-- Contenu genere depuis backend/src/encPermissions.ts (sauf la liste figee des cles obsoletes et les DELETE, propres
-- a cette migration) ; encPermissions.test.ts verifie que les deux restent synchronises.

-- ===================================================================================================================
-- Etape 0 : garde-fous. Si l'un des deux anciens roles porte encore un compte, ou qu'une delegation pointe sur une
-- permission sur le point d'etre supprimee, on interrompt AVANT toute ecriture (RAISE EXCEPTION annule toute la
-- transaction de la migration : aucune donnee n'est modifiee).
-- ===================================================================================================================
DO $$
DECLARE
  v_gest INTEGER;
  v_resp INTEGER;
  v_deleg INTEGER;
BEGIN
  SELECT count(*) INTO v_gest FROM "User" u JOIN "Role" r ON r."id" = u."roleId" WHERE r."name" = 'Encaissements – Gestionnaire';
  SELECT count(*) INTO v_resp FROM "User" u JOIN "Role" r ON r."id" = u."roleId" WHERE r."name" = 'Encaissements – Responsable';
  IF v_gest > 0 OR v_resp > 0 THEN
    RAISE EXCEPTION 'ENC_MIGRATION_BLOQUEE : % compte(s) sur "%", % compte(s) sur "%". Reaffectez ces comptes a un autre role avant de rejouer cette migration ; aucune donnee n''a ete modifiee.',
      v_gest, 'Encaissements – Gestionnaire', v_resp, 'Encaissements – Responsable';
  END IF;

  -- Defense en profondeur : le module "encaissements" n'a jamais figure dans MODULES_DELEGABLES (aucune delegation
  -- possible depuis l'interface a ce jour), mais on verifie explicitement avant de supprimer une permission.
  SELECT count(*) INTO v_deleg
  FROM "PermissionDelegation" pd
  JOIN "Permission" p ON p."id" = pd."permissionId"
  JOIN "Module" m ON m."id" = p."moduleId"
  WHERE m."key" = 'encaissements' AND p."key" IN ('enc.gerer_contrats', 'enc.parametrer_taux', 'enc.saisir_versement', 'enc.saisir_remise', 'enc.importer_encaissements', 'enc.saisir_suspens', 'enc.classer_suspens', 'enc.regler_sortant', 'enc.rapprocher', 'enc.corriger_versement_valide', 'enc.annuler_reglement', 'enc.cloturer_mois', 'enc.decloturer_mois', 'enc.deroger');
  IF v_deleg > 0 THEN
    RAISE EXCEPTION 'ENC_MIGRATION_BLOQUEE : % delegation(s) portent sur une permission Encaissements sur le point d''etre supprimee. Traitez-les manuellement avant de rejouer cette migration ; aucune donnee n''a ete modifiee.', v_deleg;
  END IF;
END $$;

-- ===================================================================================================================
-- Etape 1 : nouvelles permissions (les 3 clés conservées du V1 — consulter, importer_production, annuler_contrat —
-- existent déjà et ne sont jamais réinsérées ni réécrites).
-- ===================================================================================================================
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT v.id, v.key, v.label, m."id"
FROM (VALUES
  ('perm-enc.saisir_encaissement', 'enc.saisir_encaissement', 'Encaissements : saisir un encaissement (fiche police, paiement pour plusieurs contrats)'),
  ('perm-enc.confirmer_paiement', 'enc.confirmer_paiement', 'Encaissements : confirmer les paiements du fichier technique, importer un relevé, les frais des opérateurs'),
  ('perm-enc.corriger_encaissement', 'enc.corriger_encaissement', 'Encaissements : corriger ou contre-passer un encaissement'),
  ('perm-enc.gerer_non_identifie', 'enc.gerer_non_identifie', 'Encaissements : gérer l''argent non identifié (affecter, classer hors prime)'),
  ('perm-enc.marquer_paye', 'enc.marquer_paye', 'Encaissements : marquer payés (et décocher) taxes, commissions, honoraires et accessoires'),
  ('perm-enc.parametrer', 'enc.parametrer', 'Encaissements : paramétrer les honoraires, le partage des accessoires, les taux de contrôle et les branches')
) AS v(id, key, label)
CROSS JOIN "Module" m
WHERE m."key" = 'encaissements'
ON CONFLICT ("key") DO NOTHING;

-- ===================================================================================================================
-- Etape 2 : synchronise la description des 3 roles conserves (la migration 3a les a crees avec "ON CONFLICT DO
-- NOTHING" : sur une base ou ils existent deja, un simple re-INSERT ne mettrait jamais a jour leur description ; le
-- seed le fait pour une base de developpement reseedee, mais jamais pour la production, ou le seed ne retourne pas).
-- ===================================================================================================================
UPDATE "Role" r SET "description" = v.description
FROM (VALUES
  ('Encaissements – Équipe technique', 'Produit et importe le fichier de production, annule un contrat, consulte les signalements'),
  ('Encaissements – Finance', 'Importe la production, appelle une police, saisit/confirme/corrige/contre-passe un encaissement, gère l''argent non identifié, marque payés taxes/commissions/honoraires/accessoires, paramètre le module, exporte'),
  ('Encaissements – Consultation', 'Consultation et export, aucune modification')
) AS v(name, description)
WHERE r."name" = v.name;

-- ===================================================================================================================
-- Etape 3 : retrait des 14 permissions obsoletes du V1 (et de leurs attributions RolePermission, supprimees d'abord
-- pour respecter la cle etrangere).
-- ===================================================================================================================
DELETE FROM "RolePermission" rp
USING "Permission" p
WHERE rp."permissionId" = p."id" AND p."key" IN ('enc.gerer_contrats', 'enc.parametrer_taux', 'enc.saisir_versement', 'enc.saisir_remise', 'enc.importer_encaissements', 'enc.saisir_suspens', 'enc.classer_suspens', 'enc.regler_sortant', 'enc.rapprocher', 'enc.corriger_versement_valide', 'enc.annuler_reglement', 'enc.cloturer_mois', 'enc.decloturer_mois', 'enc.deroger');

DELETE FROM "Permission" WHERE "key" IN ('enc.gerer_contrats', 'enc.parametrer_taux', 'enc.saisir_versement', 'enc.saisir_remise', 'enc.importer_encaissements', 'enc.saisir_suspens', 'enc.classer_suspens', 'enc.regler_sortant', 'enc.rapprocher', 'enc.corriger_versement_valide', 'enc.annuler_reglement', 'enc.cloturer_mois', 'enc.decloturer_mois', 'enc.deroger');

-- ===================================================================================================================
-- Etape 4 : nouvelles attributions au role "Encaissements – Finance" (consulter et importer_production lui avaient
-- deja ete accordees par la migration 3a et restent inchangees).
-- ===================================================================================================================
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES
  ('Encaissements – Finance', 'enc.saisir_encaissement'),
  ('Encaissements – Finance', 'enc.confirmer_paiement'),
  ('Encaissements – Finance', 'enc.corriger_encaissement'),
  ('Encaissements – Finance', 'enc.gerer_non_identifie'),
  ('Encaissements – Finance', 'enc.marquer_paye'),
  ('Encaissements – Finance', 'enc.parametrer')
) AS v(role_name, permission_key)
JOIN "Role" r ON r."name" = v.role_name
JOIN "Permission" p ON p."key" = v.permission_key
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ===================================================================================================================
-- Etape 5 : suppression des roles "Gestionnaire" et "Responsable" (garantis sans compte par l'etape 0). Leurs
-- RolePermission restantes (enc.consulter, jamais supprimee a l'etape 3) sont retirees avant le role lui-meme.
-- ===================================================================================================================
DELETE FROM "RolePermission" rp
USING "Role" r
WHERE rp."roleId" = r."id" AND r."name" IN ('Encaissements – Gestionnaire', 'Encaissements – Responsable');

DELETE FROM "Role" WHERE "name" IN ('Encaissements – Gestionnaire', 'Encaissements – Responsable');
