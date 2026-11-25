-- Gestion Compta, lot GC-5b : vérifie les contraintes et les triggers des rattachements (migration 20261101190000_compta_rattachements).
-- À exécuter UNIQUEMENT sur une base jetable FRAÎCHE (voir compta-gc1a-schema.sh, étape 13) : le script met le module « en service » vers
-- la fin, ce qui ne se défait pas. Données 100 % synthétiques.

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

-- Jeu minimal : trois comptes (commercial, RFCRH, technique), un compte d'encaissement, un contrat de sept échéances de 2 500.
INSERT INTO "Role" ("id", "name") VALUES ('r-test', 'Rôle de test');
INSERT INTO "User" ("id", "fullName", "email", "roleId", "updatedAt") VALUES
  ('u-com', 'Commercial test', 'compta-gc5b-com@simassurances.test', 'r-test', now()),
  ('u-rf', 'RFCRH test', 'compta-gc5b-rf@simassurances.test', 'r-test', now()),
  ('u-test', 'Compte de test', 'compta-gc5b@simassurances.test', 'r-test', now());
INSERT INTO "CptCompte" ("id", "libelle", "type", "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now());
INSERT INTO "CptProduit" ("id", "code", "libelle", "branche", "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'ACCIDENTS', now());
INSERT INTO "CptClient" ("id", "nom", "majAt") VALUES ('cl-1', 'Client Un', now());
INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt","fractionnement")
  VALUES ('k1','POL-1','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',16100,17500,'u-test',now(),'MENSUEL');
INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt") VALUES
  ('ea','k1',1,'2026-01-01','2026-01-31','2026-01-05',2500,2300,2500,now()),
  ('eb','k1',2,'2026-02-01','2026-02-28','2026-02-05',2500,2300,2500,now()),
  ('ec','k1',3,'2026-03-01','2026-03-31','2026-03-05',2500,2300,2500,now()),
  ('ed','k1',4,'2026-04-01','2026-04-30','2026-04-05',2500,2300,2500,now()),
  ('ee','k1',5,'2026-05-01','2026-05-31','2026-05-05',2500,2300,2500,now()),
  ('ef','k1',6,'2026-06-01','2026-06-30','2026-06-05',2500,2300,2500,now()),
  ('eg','k1',7,'2026-07-01','2026-07-31','2026-07-05',2500,2300,2500,now());
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES
  ('e1','CPE-2026-000001','co-wave','T_E1',DATE '2026-03-02',2500,'ENCAISSEMENT',2500,'u-test',now()),
  ('e2','CPE-2026-000002','co-wave','T_E2',DATE '2026-03-02',4500,'ENCAISSEMENT',4500,'u-test',now()),
  ('e3','CPE-2026-000003','co-wave','T_E3',DATE '2026-03-02',2500,'ENCAISSEMENT',2500,'u-test',now()),
  ('e5','CPE-2026-000005','co-wave','T_E5',DATE '2026-03-02',2500,'ENCAISSEMENT',2500,'u-test',now());
-- Cas T1 : 4 500 payés dont 2 000 « pas une prime » (motif écrit obligatoire).
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","montantPasUnePrime","motifPasUnePrime","creeParId","majAt")
  VALUES ('e4','CPE-2026-000004','co-wave','T_E4',DATE '2026-03-02',4500,'ENCAISSEMENT',2500,2000,'Frais de carte santé','u-test',now());
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt")
  VALUES ('v1','CPE-2026-000006','co-wave','T_V1',DATE '2026-03-02',100,'VIREMENT_INTERNE_ENTRANT','SANS_OBJET',0,'u-test',now());

-- Raccourcis : une proposition, la confirmation du commercial, la validation du RFCRH.
CREATE FUNCTION pg_temp.proposer(p_id text, p_enc text, p_ech text, p_montant numeric, p_methode text, p_niveau text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$INSERT INTO "CptRattachement" ("id","encaissementId","echeanceId","montant","methode","niveauPreuve","justification","majAt")
    VALUES (%L,%L,%L,%s,%L,%L,'proposition de test',now())$f$, p_id, p_enc, p_ech, p_montant, p_methode, p_niveau);
$$;
CREATE FUNCTION pg_temp.confirmer(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$UPDATE "CptRattachement" SET "statut"='CONFIRME', "confirmeParId"='u-com', "confirmeAt"=now(), "recuReference"='REÇU-1' WHERE "id"=%L$f$, p_id);
$$;
CREATE FUNCTION pg_temp.valider(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$UPDATE "CptRattachement" SET "statut"='VALIDE', "valideParId"='u-rf', "valideAt"=now() WHERE "id"=%L$f$, p_id);
$$;
CREATE FUNCTION pg_temp.rejeter(p_id text, p_motif text) RETURNS text LANGUAGE sql AS $$
  SELECT format($f$UPDATE "CptRattachement" SET "statut"='REJETE', "rejeteParId"='u-rf', "rejeteAt"=now(), "motifRejet"=%L WHERE "id"=%L$f$, p_motif, p_id);
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Création
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('création : une proposition (déduction) est créée à l''état PROPOSE',
  pg_temp.proposer('r1','e1','ea',2500,'MONTANT_DATE','DEDUCTION'));
SELECT pg_temp.doit_reussir('création : défauts (statut PROPOSE, non repris)', $q$DO $d$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CptRattachement" WHERE id = 'r1' AND statut = 'PROPOSE' AND reprise = false AND "proposeParId" IS NULL) THEN RAISE EXCEPTION 'défauts incorrects'; END IF; END $d$$q$);
SELECT pg_temp.doit_echouer('création : un montant nul est refusé', pg_temp.proposer('rx','e1','eb',0,'MONTANT_DATE','DEDUCTION'), 'CptRattachement_montant_check');
SELECT pg_temp.doit_echouer('création : un virement interne ne se rattache pas', pg_temp.proposer('rx','v1','eb',100,'PROBABLE','A_CONFIRMER'), 'CPT_RATTACHEMENT_TYPE');
UPDATE "CptEcheance" SET "etat" = 'ANNULEE' WHERE id = 'eg';
SELECT pg_temp.doit_echouer('création : une échéance annulée ne reçoit rien', pg_temp.proposer('rx','e1','eg',2500,'PROBABLE','A_CONFIRMER'), 'CPT_RATTACHEMENT_ECHEANCE');
SELECT pg_temp.doit_echouer('création : un même couple (encaissement, échéance) vivant deux fois est refusé', pg_temp.proposer('rx','e1','ea',2500,'MONTANT_DATE','DEDUCTION'), 'CptRattachement_actif_key');
SELECT pg_temp.doit_echouer('création : encaissement inconnu refusé', pg_temp.proposer('rx','inconnu','eb',1,'MONTANT_DATE','DEDUCTION'), 'CPT_RATTACHEMENT_TYPE');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Étape 1 : la confirmation du commercial, avec le reçu
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_echouer('validation d''un niveau « déduction » sans confirmation refusée (RG-02)', pg_temp.valider('r1'), 'CptRattachement_etape1_check');
SELECT pg_temp.doit_echouer('confirmation sans reçu refusée', $q$UPDATE "CptRattachement" SET "statut"='CONFIRME', "confirmeParId"='u-com', "confirmeAt"=now() WHERE id='r1'$q$, 'CptRattachement_confirme_check');
SELECT pg_temp.doit_echouer('confirmation avec un reçu vide refusée', $q$UPDATE "CptRattachement" SET "statut"='CONFIRME', "confirmeParId"='u-com', "confirmeAt"=now(), "recuReference"='   ' WHERE id='r1'$q$, 'CptRattachement_confirme_check');
SELECT pg_temp.doit_reussir('confirmation avec le reçu (étape 1)', pg_temp.confirmer('r1'));
SELECT pg_temp.doit_echouer('le compte qui a confirmé ne valide pas (séparation des tâches)', $q$UPDATE "CptRattachement" SET "statut"='VALIDE', "valideParId"='u-com', "valideAt"=now() WHERE id='r1'$q$, 'CptRattachement_separation_check');
SELECT pg_temp.doit_echouer('validation sans auteur ni date refusée', $q$UPDATE "CptRattachement" SET "statut"='VALIDE' WHERE id='r1'$q$, 'CptRattachement_valide_check');
SELECT pg_temp.doit_reussir('validation par le RFCRH après confirmation (étape 2)', pg_temp.valider('r1'));
SELECT pg_temp.doit_echouer('un rattachement validé est définitif', $q$UPDATE "CptRattachement" SET "commentaireConfirmation"='retouche' WHERE id='r1'$q$, 'CPT_IMMUABLE');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Niveau « preuve » : pas d'étape 1
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('création : référence exacte (preuve)', pg_temp.proposer('r2','e2','eb',2500,'REFERENCE_EXACTE','PREUVE'));
SELECT pg_temp.doit_echouer('un niveau « preuve » n''a pas d''étape de confirmation', pg_temp.confirmer('r2'), 'CptRattachement_confirme_check');
SELECT pg_temp.doit_echouer('les champs de la proposition ne changent jamais', $q$UPDATE "CptRattachement" SET "montant"=1 WHERE id='r2'$q$, 'ne changent jamais');
SELECT pg_temp.doit_reussir('validation directe d''un niveau « preuve »', pg_temp.valider('r2'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Plafonds (RG-04), sous verrou
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('création : seconde part de l''encaissement de 4 500', pg_temp.proposer('r3','e2','ec',2500,'REFERENCE_EXACTE','PREUVE'));
SELECT pg_temp.doit_echouer('Σ validés au-delà du montant de l''encaissement refusée (2 500 + 2 500 > 4 500)', pg_temp.valider('r3'), 'CPT_SOMME_ENCAISSEMENT');
SELECT pg_temp.doit_echouer('rejet sans motif refusé', $q$UPDATE "CptRattachement" SET "statut"='REJETE', "rejeteParId"='u-rf', "rejeteAt"=now() WHERE id='r3'$q$, 'CptRattachement_rejete_check');
SELECT pg_temp.doit_reussir('rejet avec motif', pg_temp.rejeter('r3', 'Montant trop élevé pour cette échéance'));
SELECT pg_temp.doit_echouer('un rattachement rejeté est définitif', pg_temp.confirmer('r3'), 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('un rejet libère le couple : nouvelle proposition de 2 000', pg_temp.proposer('r4','e2','ec',2000,'REFERENCE_EXACTE','PREUVE'));
SELECT pg_temp.doit_reussir('validation jusqu''au montant exact (2 500 + 2 000 = 4 500)', pg_temp.valider('r4'));
SELECT pg_temp.doit_reussir('création : une autre part sur une échéance déjà soldée', pg_temp.proposer('r5','e3','ea',100,'REFERENCE_EXACTE','PREUVE'));
SELECT pg_temp.doit_echouer('Σ validés au-delà du montant dû de l''échéance refusée', pg_temp.valider('r5'), 'CPT_SOMME_ECHEANCE');
SELECT pg_temp.doit_reussir('T1 : 4 500 dont 2 000 « pas une prime » : 2 500 rattachés', pg_temp.proposer('r6','e4','ed',2500,'REFERENCE_EXACTE','PREUVE') || '; ' || pg_temp.valider('r6'));
SELECT pg_temp.doit_reussir('création : une part de plus sur l''encaissement déjà soldé par « pas une prime »', pg_temp.proposer('r7','e4','ee',1,'REFERENCE_EXACTE','PREUVE'));
SELECT pg_temp.doit_echouer('T1 : la part « pas une prime » compte dans le plafond', pg_temp.valider('r7'), 'CPT_SOMME_ENCAISSEMENT');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Transitions
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('création : proposition à confirmer', pg_temp.proposer('r8','e5','ef',2500,'PROBABLE','A_CONFIRMER'));
SELECT pg_temp.doit_reussir('confirmation', pg_temp.confirmer('r8'));
SELECT pg_temp.doit_echouer('une confirmation ne se défait pas', $q$UPDATE "CptRattachement" SET "statut"='PROPOSE' WHERE id='r8'$q$, 'CPT_TRANSITION');
SELECT pg_temp.doit_reussir('rejet d''une proposition confirmée', pg_temp.rejeter('r8', 'Le reçu ne correspond pas au payeur'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Suppression : acceptée avant la mise en service
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('DELETE accepté avant la mise en service', pg_temp.proposer('r9','e5','ef',2500,'PROBABLE','A_CONFIRMER') || '; DELETE FROM "CptRattachement" WHERE id = ''r9''');

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Après la mise en service : plus de suppression
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ('u-test', 'sha-synthetique');
SELECT pg_temp.doit_echouer('rattachement : DELETE interdit après la mise en service', $q$DELETE FROM "CptRattachement" WHERE id = 'r1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('rattachement : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptRattachement" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('une proposition avance encore après la mise en service', pg_temp.proposer('r10','e5','ee',2500,'PROBABLE','A_CONFIRMER') || '; ' || pg_temp.confirmer('r10') || '; ' || pg_temp.valider('r10'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Indépendance : aucun trigger de cette table n'utilise une fonction d'un autre module
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('indépendance : triggers des rattachements = fonctions cpt_*', $q$
  DO $d$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND c.relname = 'CptRattachement' AND p.proname NOT LIKE 'cpt\_%'
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
    RAISE EXCEPTION 'GC-5b : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
END $$;
