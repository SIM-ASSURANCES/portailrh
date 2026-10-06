-- Rattrapage : permissions présentes dans le seed mais créées par AUCUNE migration (2026-10-06).
--
-- Une base de production est seedée UNE fois, à son premier déploiement : une permission ajoutée au seed après ce
-- jour n'y existe pas tant qu'aucune migration ne la crée. Historique du seed comparé à son état au premier
-- déploiement (commit 54c580c du 2026-08-29, conteneurisation) : 17 permissions ajoutées depuis, dont 14 déjà créées
-- par une migration (`feedback.moderer`, `systeme.reinitialiser`, `treso.alimenter_caisse`,
-- `treso.corriger_solde_ouverture`, les 10 de `20261006100000_tresorerie_permissions_explicites`). Restent trois :
--   - treso.saisir_depense_directe        (seed du 2026-08-30)
--   - treso.approuver_validation_complete (seed du 2026-09-01)
--   - treso.gerer_categories              (seed du 2026-09-11)
-- Les `enc.*` sont toutes créées par leurs migrations. Cette migration garantit aussi les 11 autres permissions de
-- base `treso.*`, présentes dans le seed dès le premier déploiement.
--
-- Une permission créée ICI (absente avant) est donnée aux rôles qui ont déjà sa permission « sœur » — jamais un nom
-- de rôle :
--   - gerer_categories              <- treso.categoriser_demande (Finance : catégorise, donc gère le catalogue)
--   - saisir_depense_directe        <- treso.categoriser_demande (Finance seule dans le seed, ni DG ni Assistant)
--   - approuver_validation_complete <- systeme.reinitialiser     (DG seul, posée par 20260925100000)
-- Les 11 permissions de base ne sont données à personne : elles ne peuvent manquer que sur une base jamais seedée,
-- qui n'a pas de rôle.
--
-- DOIT passer avant 20261006100000 : celle-ci repère Finance par « valider_demande SANS
-- approuver_validation_complete ». Sur une base où le DG n'aurait pas encore approuver_validation_complete, le DG
-- (qui a valider_demande) recevrait sinon les 10 permissions de décision Finance.
--
-- Idempotente : rejouée, elle ne crée rien et ne donne rien (seules les permissions absentes avant sont distribuées).

-- Module Trésorerie (absent seulement d'une base jamais seedée ; le seed le recrée de toute façon).
INSERT INTO "Module" ("id", "key", "label", "isActive")
VALUES ('module-tresorerie', 'tresorerie', 'Gestion des demandes et trésorerie', true)
ON CONFLICT ("key") DO NOTHING;

DROP TABLE IF EXISTS "_rattrapage_permissions";
CREATE TEMP TABLE "_rattrapage_permissions" AS
SELECT v.cle, v.libelle, v.soeur
FROM (VALUES
  ('treso.creer_demande', 'Créer une demande', NULL),
  ('treso.categoriser_demande', 'Catégoriser une demande', NULL),
  ('treso.valider_demande', 'Valider une demande', NULL),
  ('treso.effectuer_reglement', 'Effectuer un règlement', NULL),
  ('treso.declarer_retour', 'Déclarer un retour de caisse', NULL),
  ('treso.receptionner_retour', 'Réceptionner un retour de caisse', NULL),
  ('treso.cloturer_demande', 'Clôturer une demande', NULL),
  ('treso.alimenter_caisse', 'Enregistrer une alimentation de caisse', NULL),
  ('treso.corriger_solde_ouverture', 'Définir/corriger le solde d''ouverture de caisse', NULL),
  ('treso.voir_dashboard_finance', 'Voir le dashboard finance', NULL),
  ('treso.voir_reporting', 'Voir le reporting', NULL),
  ('treso.saisir_depense_directe', 'Saisir une dépense directe', 'treso.categoriser_demande'),
  ('treso.approuver_validation_complete', 'Approuver la validation complète (verrou de clôture)', 'systeme.reinitialiser'),
  ('treso.gerer_categories', 'Gérer les catégories et objets d''achat (créer/supprimer)', 'treso.categoriser_demande')
) AS v(cle, libelle, soeur)
WHERE NOT EXISTS (SELECT 1 FROM "Permission" p WHERE p."key" = v.cle);

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-' || replace(r.cle, '.', '-'), r.cle, r.libelle, m."id"
FROM "_rattrapage_permissions" r, "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

-- Permissions du RÔLE seulement (jamais celles reçues par délégation).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT DISTINCT rp."roleId", p."id"
FROM "_rattrapage_permissions" r
JOIN "Permission" ps ON ps."key" = r.soeur
JOIN "RolePermission" rp ON rp."permissionId" = ps."id"
JOIN "Permission" p ON p."key" = r.cle
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DROP TABLE "_rattrapage_permissions";
