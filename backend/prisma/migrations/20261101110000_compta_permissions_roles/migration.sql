-- Gestion Compta, lot GC-1c : module, permissions, rôles de départ, attribution au DG (docs/compta-conception.md §4, W10).
-- Rejouable : ON CONFLICT DO NOTHING partout. Sur une base neuve, seed.ts crée déjà ces lignes ; une migration ne s'exécute
-- qu'une fois par base, donc elle n'écrase jamais une modification faite ensuite dans /admin/roles.
-- Source unique : backend/src/cptPermissions.ts ; cptPermissionsMigration.test.ts échoue si ce fichier diverge.
--
-- Rôles de départ PROVISOIRES tant que la RH n'a pas répondu à Q5 (qui occupe chaque profil).
-- Le DG est un superviseur (réponse Q4) : le rôle qui porte la permission sœur « systeme.reinitialiser » reçoit la consultation,
-- l'arbitrage des litiges et la mise en service, JAMAIS par son nom. Aucun autre rôle existant n'est touché.

INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('module-compta', 'compta', 'Gestion Compta', true)
ON CONFLICT ("key") DO NOTHING;

-- Module technique « systeme » (déjà créé par 20260925100000_reinitialisation_systeme ; repris ici par sécurité).
INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('systeme-module-reinit', 'systeme', 'Système', true)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT v.id, v.key, v.label, m."id"
FROM (VALUES
  ('perm-cpt-consulter', 'cpt.consulter', 'Gestion Compta : consulter et exporter'),
  ('perm-cpt-importer-production', 'cpt.importer_production', 'Gestion Compta : importer le bordereau de production'),
  ('perm-cpt-saisir-contrat', 'cpt.saisir_contrat', 'Gestion Compta : saisir et corriger un contrat'),
  ('perm-cpt-importer-releves', 'cpt.importer_releves', 'Gestion Compta : importer les relevés d''encaissement'),
  ('perm-cpt-identifier-encaissement', 'cpt.identifier_encaissement', 'Gestion Compta : identifier un encaissement (produit, client, partenaire, contrat)'),
  ('perm-cpt-confirmer-rattachement', 'cpt.confirmer_rattachement', 'Gestion Compta : confirmer un rattachement avec le reçu (étape 1)'),
  ('perm-cpt-valider-rattachement', 'cpt.valider_rattachement', 'Gestion Compta : valider ou rejeter un rattachement (étape 2)'),
  ('perm-cpt-classer-pas-une-prime', 'cpt.classer_pas_une_prime', 'Gestion Compta : classer un encaissement « pas une prime » (motif écrit)'),
  ('perm-cpt-declarer-tca', 'cpt.declarer_tca', 'Gestion Compta : déclarer la taxe du mois'),
  ('perm-cpt-payer-tca', 'cpt.payer_tca', 'Gestion Compta : enregistrer le paiement de la taxe et sa quittance'),
  ('perm-cpt-regler-partenaire', 'cpt.regler_partenaire', 'Gestion Compta : régler un partenaire'),
  ('perm-cpt-compenser', 'cpt.compenser', 'Gestion Compta : compenser entre natures de rémunération (opération explicite)'),
  ('perm-cpt-gerer-conventions', 'cpt.gerer_conventions', 'Gestion Compta : gérer les conventions des partenaires'),
  ('perm-cpt-parametrer', 'cpt.parametrer', 'Gestion Compta : paramétrer les taux de taxe, formats d''import, comptes et seuils'),
  ('perm-cpt-preparer-ecritures', 'cpt.preparer_ecritures', 'Gestion Compta : préparer les exports Odoo et la liste des éléments non comptabilisés'),
  ('perm-cpt-relancer', 'cpt.relancer', 'Gestion Compta : relancer et suivre les promesses de paiement'),
  ('perm-cpt-cloturer-periode', 'cpt.cloturer_periode', 'Gestion Compta : clôturer un mois'),
  ('perm-cpt-trancher-litige', 'cpt.trancher_litige', 'Gestion Compta : trancher un litige (direction générale)')
) AS v(id, key, label)
JOIN "Module" m ON m."key" = 'compta'
ON CONFLICT ("key") DO NOTHING;

-- Mise en service : module technique « systeme » (jamais une carte, jamais dans la matrice /admin/roles).
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'perm-cpt-mettre-en-service', 'cpt.mettre_en_service', 'Gestion Compta : mettre le module en service (remise à zéro, usage unique)', m."id"
FROM "Module" m
WHERE m."key" = 'systeme'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Role" ("id", "name", "description", "estAdmin", "peutEtreBeneficiaireDelegation", "peutRecevoirFeedback")
VALUES
  ('role-compta-1', 'Compta – Production', 'Service technique : saisit et importe les contrats, corrige les contrats signalés, relance', false, false, true),
  ('role-compta-2', 'Compta – Commercial', 'Identifie les encaissements sans contrat, confirme les rattachements avec le reçu, relance les clients', false, false, true),
  ('role-compta-3', 'Compta – RFCRH', 'Valide les rattachements, classe « pas une prime », déclare et paie la taxe, règle et compense les partenaires, gère conventions et paramètres, prépare les écritures, clôture le mois', false, false, true),
  ('role-compta-4', 'Compta – Comptable', 'Stagiaire comptable : importe les relevés et la production, prépare les listes et les écritures Odoo', false, false, true),
  ('role-compta-5', 'Compta – Direction', 'Direction générale : consulte tous les tableaux de bord, tranche les litiges, ne saisit rien', false, false, true)
ON CONFLICT ("name") DO NOTHING;

-- Attribution aux seuls rôles « Compta – » créés ci-dessus (leurs noms sont propres au module).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES
  ('Compta – Production', 'cpt.consulter'),
  ('Compta – Production', 'cpt.importer_production'),
  ('Compta – Production', 'cpt.saisir_contrat'),
  ('Compta – Production', 'cpt.relancer'),
  ('Compta – Commercial', 'cpt.consulter'),
  ('Compta – Commercial', 'cpt.identifier_encaissement'),
  ('Compta – Commercial', 'cpt.confirmer_rattachement'),
  ('Compta – Commercial', 'cpt.relancer'),
  ('Compta – RFCRH', 'cpt.consulter'),
  ('Compta – RFCRH', 'cpt.identifier_encaissement'),
  ('Compta – RFCRH', 'cpt.valider_rattachement'),
  ('Compta – RFCRH', 'cpt.classer_pas_une_prime'),
  ('Compta – RFCRH', 'cpt.declarer_tca'),
  ('Compta – RFCRH', 'cpt.payer_tca'),
  ('Compta – RFCRH', 'cpt.regler_partenaire'),
  ('Compta – RFCRH', 'cpt.compenser'),
  ('Compta – RFCRH', 'cpt.gerer_conventions'),
  ('Compta – RFCRH', 'cpt.parametrer'),
  ('Compta – RFCRH', 'cpt.preparer_ecritures'),
  ('Compta – RFCRH', 'cpt.relancer'),
  ('Compta – RFCRH', 'cpt.cloturer_periode'),
  ('Compta – Comptable', 'cpt.consulter'),
  ('Compta – Comptable', 'cpt.importer_production'),
  ('Compta – Comptable', 'cpt.importer_releves'),
  ('Compta – Comptable', 'cpt.preparer_ecritures'),
  ('Compta – Direction', 'cpt.consulter'),
  ('Compta – Direction', 'cpt.trancher_litige')
) AS a(role, cle)
JOIN "Role" r ON r."name" = a.role
JOIN "Permission" p ON p."key" = a.cle
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Le DG superviseur : PAR PERMISSION SŒUR (le rôle qui porte « systeme.reinitialiser »), jamais par un nom de rôle.
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", np."id"
FROM (VALUES
  ('cpt.consulter', 'systeme.reinitialiser'),
  ('cpt.trancher_litige', 'systeme.reinitialiser'),
  ('cpt.mettre_en_service', 'systeme.reinitialiser')
) AS m(nouvelle, soeur)
JOIN "Permission" np ON np."key" = m.nouvelle
JOIN "Permission" sp ON sp."key" = m.soeur
JOIN "RolePermission" rp ON rp."permissionId" = sp."id"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
