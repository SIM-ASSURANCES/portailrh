-- Gestion Compta, lot GC-3a : vérifie les contraintes et les triggers de la production (migration
-- 20261101160000_compta_production). À exécuter UNIQUEMENT sur une base jetable FRAÎCHE (voir compta-gc1a-schema.sh, étape 9) :
-- le script met le module « en service » vers la fin, ce qui ne se défait pas. Données 100 % synthétiques.

CREATE TEMP TABLE resultats (nom text NOT NULL, ok boolean NOT NULL, detail text);

CREATE FUNCTION pg_temp.doit_reussir(p_nom text, p_requete text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_requete;
  INSERT INTO resultats VALUES (p_nom, true, NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO resultats VALUES (p_nom, false, 'erreur inattendue : ' || SQLERRM);
END;
$$;

CREATE FUNCTION pg_temp.doit_echouer(p_nom text, p_requete text, p_attendu text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_requete;
  INSERT INTO resultats VALUES (p_nom, false, 'aucune erreur alors qu''un refus était attendu');
EXCEPTION WHEN OTHERS THEN
  IF position(p_attendu in SQLERRM) > 0 THEN
    INSERT INTO resultats VALUES (p_nom, true, NULL);
  ELSE
    INSERT INTO resultats VALUES (p_nom, false, 'mauvais message : ' || SQLERRM);
  END IF;
END;
$$;

-- Jeu minimal.
INSERT INTO "Role" ("id", "name") VALUES ('r-test', 'Rôle de test');
INSERT INTO "User" ("id", "fullName", "email", "roleId", "updatedAt")
  VALUES ('u-test', 'Compte de test', 'compta-gc3a@simassurances.test', 'r-test', now());
INSERT INTO "CptPartenaire" ("id", "nom", "estApporteur", "majAt") VALUES ('p-a', 'Courtier A', true, now());
INSERT INTO "CptProduit" ("id", "code", "libelle", "branche", "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'ACCIDENTS', now());
INSERT INTO "CptClient" ("id", "nom", "majAt") VALUES ('cl-1', 'Client Un', now());
INSERT INTO "CptCompte" ("id", "libelle", "type", "majAt") VALUES ('co-1', 'Wave 1', 'WAVE_BUSINESS', now());
INSERT INTO "CptPieceJointe" ("id", "url", "mime", "taille", "sha256", "deposeeParId")
  VALUES ('pj-1', 'uploads/a.xlsx', 'application/vnd.ms-excel', 10, 'aaa', 'u-test'), ('pj-2', 'uploads/b.xlsx', 'application/vnd.ms-excel', 10, 'bbb', 'u-test'),
         ('pj-3', 'uploads/c.xlsx', 'application/vnd.ms-excel', 10, 'ccc', 'u-test');

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Imports : un fichier ne s'importe qu'une fois
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('import : création', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","creeParId") VALUES ('i1','PRODUCTION','pj-1','emp-1','u-test')$q$);
SELECT pg_temp.doit_echouer('import : même empreinte refusée (fichier déjà importé)', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","creeParId") VALUES ('i2','PRODUCTION','pj-2','emp-1','u-test')$q$, 'CptImport_empreinte_key');
SELECT pg_temp.doit_echouer('import : même pièce jointe refusée', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","creeParId") VALUES ('i3','PRODUCTION','pj-1','emp-3','u-test')$q$, 'CptImport_fichierId_key');
SELECT pg_temp.doit_echouer('import : type inconnu refusé par l''enum', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","creeParId") VALUES ('i4','AUTRE','pj-2','emp-4','u-test')$q$, 'CptTypeImport');
SELECT pg_temp.doit_echouer('import : période qui n''est pas le premier du mois refusée', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","compteId","periode","creeParId") VALUES ('i5','RELEVE_WAVE_BUSINESS','pj-2','emp-5','co-1','2026-03-15','u-test')$q$, 'CptImport_periode_check');
SELECT pg_temp.doit_reussir('import : période = premier du mois acceptée', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","compteId","periode","creeParId") VALUES ('i6','RELEVE_WAVE_BUSINESS','pj-2','emp-6','co-1','2026-03-01','u-test')$q$);
SELECT pg_temp.doit_echouer('import : compte inconnu refusé', $q$INSERT INTO "CptImport" ("id","type","fichierId","empreinte","compteId","creeParId") VALUES ('i7','RELEVE_BANQUE','pj-3','emp-7','inconnu','u-test')$q$, 'CptImport_compteId_fkey');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Contrats
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('contrat : création (statut EN_COURS, comptant, par défaut)', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt","importId") VALUES ('k1','POL-1','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',100000,107250,'u-test',now(),'i1')$q$);
SELECT pg_temp.doit_reussir('contrat : valeurs par défaut', $q$DO $d$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CptContrat" WHERE id = 'k1' AND statut = 'EN_COURS' AND fractionnement = 'COMPTANT' AND "declarePaye" = false AND taxe = 0 AND "accessoiresHt" = 0) THEN RAISE EXCEPTION 'défauts incorrects'; END IF; END $d$$q$);
SELECT pg_temp.doit_echouer('contrat : numéro de police unique', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt") VALUES ('k2','POL-1','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',1,1,'u-test',now())$q$, 'CptContrat_numPolice_key');
SELECT pg_temp.doit_echouer('contrat : prime négative refusée', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt") VALUES ('k3','POL-3','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',-1,1,'u-test',now())$q$, 'CptContrat_montants_check');
SELECT pg_temp.doit_echouer('contrat : échéance avant l''effet refusée', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt") VALUES ('k4','POL-4','pr-1','INDIVIDUEL','cl-1','2026-06-01','2026-05-31',1,1,'u-test',now())$q$, 'CptContrat_periode_check');
SELECT pg_temp.doit_echouer('contrat : taux de TCA supérieur à 100 % refusé', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","tauxTcaContrat","creeParId","majAt") VALUES ('k5','POL-5','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',1,1,1.5,'u-test',now())$q$, 'CptContrat_taux_check');
SELECT pg_temp.doit_reussir('contrat : taux de TCA propre au contrat (SECURPRO) accepté', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","tauxTcaContrat","creeParId","majAt","partenaireApporteurId","fractionnement") VALUES ('k6','POL-6','pr-1','GROUPE','cl-1','2026-01-01','2026-12-31',1000,1075,0.0725,'u-test',now(),'p-a','MENSUEL')$q$);
SELECT pg_temp.doit_echouer('contrat : auto-référence refusée', $q$UPDATE "CptContrat" SET "contratOrigineId" = 'k1' WHERE id = 'k1'$q$, 'CptContrat_origine_check');
SELECT pg_temp.doit_reussir('contrat : renouvellement lié au contrat d''origine', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt","contratOrigineId") VALUES ('k7','POL-1-R1','pr-1','INDIVIDUEL','cl-1','2027-01-01','2027-12-31',100000,107250,'u-test',now(),'k1')$q$);
SELECT pg_temp.doit_echouer('contrat : produit inconnu refusé', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt") VALUES ('k8','POL-8','inconnu','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',1,1,'u-test',now())$q$, 'CptContrat_produitId_fkey');
SELECT pg_temp.doit_echouer('contrat : fractionnement inconnu refusé par l''enum', $q$INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt","fractionnement") VALUES ('k9','POL-9','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',1,1,'u-test',now(),'ANNUEL')$q$, 'CptFractionnement');
SELECT pg_temp.doit_echouer('produit référencé par un contrat : suppression refusée', $q$DELETE FROM "CptProduit" WHERE id = 'pr-1'$q$, 'violates foreign key constraint');
SELECT pg_temp.doit_echouer('client référencé par un contrat : suppression refusée', $q$DELETE FROM "CptClient" WHERE id = 'cl-1'$q$, 'violates foreign key constraint');
SELECT pg_temp.doit_echouer('import référencé par un contrat : suppression refusée', $q$DELETE FROM "CptImport" WHERE id = 'i1'$q$, 'violates foreign key constraint');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Actes : ajout seul, montants signés
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('acte : affaire nouvelle', $q$INSERT INTO "CptActe" ("id","contratId","type","date","primeNetteHt","primeTtc","creeParId") VALUES ('a1','k1','AFFAIRE_NOUVELLE','2026-01-01',100000,107250,'u-test')$q$);
SELECT pg_temp.doit_reussir('acte : retrait avec ristourne (montants négatifs acceptés) lié à l''acte d''origine', $q$INSERT INTO "CptActe" ("id","contratId","type","date","primeNetteHt","primeTtc","acteOrigineId","motif","creeParId") VALUES ('a2','k1','RETRAIT','2026-06-30',-50000,-53625,'a1','Retrait d''un assuré','u-test')$q$);
SELECT pg_temp.doit_echouer('acte : type inconnu refusé par l''enum', $q$INSERT INTO "CptActe" ("id","contratId","type","date","creeParId") VALUES ('a3','k1','AUTRE','2026-01-01','u-test')$q$, 'CptTypeActe');
SELECT pg_temp.doit_echouer('acte : contrat inconnu refusé', $q$INSERT INTO "CptActe" ("id","contratId","type","date","creeParId") VALUES ('a4','inconnu','AFFAIRE_NOUVELLE','2026-01-01','u-test')$q$, 'CptActe_contratId_fkey');
SELECT pg_temp.doit_echouer('acte : un acte ne s''auto-référence pas', $q$INSERT INTO "CptActe" ("id","contratId","type","date","creeParId","acteOrigineId") VALUES ('a5','k1','RETRAIT','2026-01-01','u-test','a5')$q$, 'CptActe_origine_check');
SELECT pg_temp.doit_echouer('acte : jamais modifié (UPDATE interdit)', $q$UPDATE "CptActe" SET "motif" = 'corrigé' WHERE id = 'a1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('acte : DELETE accepté avant la mise en service', $q$INSERT INTO "CptActe" ("id","contratId","type","date","creeParId") VALUES ('a6','k1','TRANCHE','2026-02-01','u-test'); DELETE FROM "CptActe" WHERE id = 'a6'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Échéances
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('échéance : création', $q$INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt") VALUES ('e1','k6',1,'2026-01-01','2026-01-31','2026-01-01',89.58,83.33,89.58,now())$q$);
SELECT pg_temp.doit_echouer('échéance : un rang par contrat', $q$INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt") VALUES ('e2','k6',1,'2026-02-01','2026-02-28','2026-02-01',1,1,1,now())$q$, 'CptEcheance_contratId_rang_key');
SELECT pg_temp.doit_echouer('échéance : rang 0 refusé', $q$INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt") VALUES ('e3','k6',0,'2026-02-01','2026-02-28','2026-02-01',1,1,1,now())$q$, 'CptEcheance_rang_check');
SELECT pg_temp.doit_echouer('échéance : fin de période avant le début refusée', $q$INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt") VALUES ('e4','k6',2,'2026-02-28','2026-02-01','2026-02-01',1,1,1,now())$q$, 'CptEcheance_periode_check');
SELECT pg_temp.doit_echouer('échéance : montant négatif refusé', $q$INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt") VALUES ('e5','k6',3,'2026-03-01','2026-03-31','2026-03-01',-1,1,1,now())$q$, 'CptEcheance_montants_check');
SELECT pg_temp.doit_reussir('échéance : montant réglé supérieur au dû accepté (trop-perçu à traiter)', $q$UPDATE "CptEcheance" SET "montantRegle" = 100 WHERE id = 'e1'$q$);
SELECT pg_temp.doit_echouer('échéance : état inconnu refusé par l''enum', $q$UPDATE "CptEcheance" SET etat = 'PAYEE' WHERE id = 'e1'$q$, 'CptEtatEcheance');
SELECT pg_temp.doit_echouer('contrat référencé par une échéance : suppression refusée', $q$DELETE FROM "CptContrat" WHERE id = 'k6'$q$, 'violates foreign key constraint');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Anomalies
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('anomalie : création à traiter', $q$INSERT INTO "CptAnomalie" ("id","type","objetEntite","objetId","detail","importId") VALUES ('an1','MONTANT_INCOHERENT','CONTRAT','k1','{"ligne":4}'::jsonb,'i1')$q$);
SELECT pg_temp.doit_echouer('anomalie : traitée sans traitant refusée', $q$UPDATE "CptAnomalie" SET statut = 'TRAITEE' WHERE id = 'an1'$q$, 'CptAnomalie_traitee_check');
SELECT pg_temp.doit_reussir('anomalie : traitée avec traitant et date acceptée', $q$UPDATE "CptAnomalie" SET statut = 'TRAITEE', "traiteeParId" = 'u-test', "traiteeAt" = now(), resolution = 'Corrigé' WHERE id = 'an1'$q$);
SELECT pg_temp.doit_echouer('anomalie : import inconnu refusé', $q$INSERT INTO "CptAnomalie" ("id","type","objetEntite","objetId","importId") VALUES ('an2','X','CONTRAT','k1','inconnu')$q$, 'CptAnomalie_importId_fkey');

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Avant la mise en service : suppression acceptée
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('anomalie : DELETE accepté avant la mise en service', $q$INSERT INTO "CptAnomalie" ("id","type","objetEntite","objetId") VALUES ('an3','X','CONTRAT','k1'); DELETE FROM "CptAnomalie" WHERE id = 'an3'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Après la mise en service : plus de suppression
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ('u-test', 'sha-synthetique');
SELECT pg_temp.doit_echouer('contrat : DELETE interdit après la mise en service', $q$DELETE FROM "CptContrat" WHERE id = 'k7'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('échéance : DELETE interdit après la mise en service', $q$DELETE FROM "CptEcheance" WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('acte : DELETE interdit après la mise en service', $q$DELETE FROM "CptActe" WHERE id = 'a2'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('import : DELETE interdit après la mise en service', $q$DELETE FROM "CptImport" WHERE id = 'i6'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('anomalie : DELETE interdit après la mise en service', $q$DELETE FROM "CptAnomalie" WHERE id = 'an1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('contrat : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptContrat" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('acte : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptActe"$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('échéance : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptEcheance"$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('anomalie : traitement toujours possible après la mise en service', $q$INSERT INTO "CptAnomalie" ("id","type","objetEntite","objetId") VALUES ('an4','X','CONTRAT','k1'); UPDATE "CptAnomalie" SET statut = 'TRAITEE', "traiteeParId" = 'u-test', "traiteeAt" = now() WHERE id = 'an4'$q$);
SELECT pg_temp.doit_reussir('contrat : mise à jour toujours possible après la mise en service (réimport)', $q$UPDATE "CptContrat" SET statut = 'ECHU' WHERE id = 'k7'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Indépendance : aucun trigger de ces tables n'utilise une fonction d'un autre module
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('indépendance : triggers de la production = fonctions cpt_*', $q$
  DO $d$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND c.relname IN ('CptContrat','CptActe','CptEcheance','CptImport','CptAnomalie') AND p.proname NOT LIKE 'cpt\_%'
    ) THEN RAISE EXCEPTION 'un trigger Gestion Compta utilise une fonction d''un autre module'; END IF;
  END $d$;
$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- Bilan
-- ---------------------------------------------------------------------------------------------------------------------
SELECT CASE WHEN ok THEN 'OK ' ELSE 'KO ' END || nom || coalesce('  -> ' || detail, '') AS resultat FROM resultats;

DO $$
DECLARE n_ko int; n_total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO n_ko, n_total FROM resultats;
  IF n_ko > 0 THEN
    RAISE EXCEPTION 'GC-3a : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
  RAISE NOTICE 'GC-3a : % contrôles réussis, 0 échec', n_total;
END;
$$;
