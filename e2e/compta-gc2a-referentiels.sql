-- Gestion Compta, lot GC-2a : vérifie les contraintes et les triggers des référentiels (migration
-- 20261101140000_compta_referentiels). À exécuter UNIQUEMENT sur une base jetable FRAÎCHE (voir compta-gc1a-schema.sh, étape 7) :
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
  VALUES ('u-test', 'Compte de test', 'compta-gc2a@simassurances.test', 'r-test', now());
INSERT INTO "CptPartenaire" ("id", "nom", "estApporteur", "majAt") VALUES ('p-a', 'Partenaire A', true, now()), ('p-b', 'Partenaire B', true, now());
INSERT INTO "CptProduit" ("id", "code", "libelle", "branche", "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'ACCIDENTS', now()), ('pr-2', 'P2', 'Produit 2', 'DECES', now());

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Partenaires et produits
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_echouer('partenaire : le nom est unique', $q$INSERT INTO "CptPartenaire" ("id","nom","majAt") VALUES ('p-dup','Partenaire A',now())$q$, 'CptPartenaire_nom_key');
SELECT pg_temp.doit_echouer('produit : le code est unique', $q$INSERT INTO "CptProduit" ("id","code","libelle","branche","majAt") VALUES ('pr-dup','P1','Autre','SANTE',now())$q$, 'CptProduit_code_key');
SELECT pg_temp.doit_echouer('produit : branche inconnue refusée par l''enum', $q$INSERT INTO "CptProduit" ("id","code","libelle","branche","majAt") VALUES ('pr-x','PX','X','AUTO',now())$q$, 'CptBranche');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Taux de TCA : unicité avec NULL, bornes, jamais modifié
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('taux : « branche seule » à une date', $q$INSERT INTO "CptTauxTca" ("id","branche","taux","dateEffet","creeParId") VALUES ('t1','ACCIDENTS',0.0725,'2026-01-01','u-test')$q$);
SELECT pg_temp.doit_echouer('taux : même branche, même date (NULL traité comme une valeur)', $q$INSERT INTO "CptTauxTca" ("id","branche","taux","dateEffet","creeParId") VALUES ('t1b','ACCIDENTS',0.04,'2026-01-01','u-test')$q$, 'CptTauxTca_unique_portee_date');
SELECT pg_temp.doit_reussir('taux : même branche, nouvelle date (l''ancienne ligne reste)', $q$INSERT INTO "CptTauxTca" ("id","branche","taux","dateEffet","creeParId") VALUES ('t2','ACCIDENTS',0.04,'2026-07-01','u-test')$q$);
SELECT pg_temp.doit_reussir('taux : portée « produit » à la même date', $q$INSERT INTO "CptTauxTca" ("id","branche","produitCode","taux","dateEffet","creeParId") VALUES ('t3','ACCIDENTS','P1',0.015,'2026-01-01','u-test')$q$);
SELECT pg_temp.doit_reussir('taux : portée « produit + nature »', $q$INSERT INTO "CptTauxTca" ("id","branche","produitCode","natureContrat","taux","dateEffet","creeParId") VALUES ('t4','ACCIDENTS','P1','GROUPE',0.125,'2026-01-01','u-test')$q$);
SELECT pg_temp.doit_echouer('taux : « produit + nature » en double à la même date', $q$INSERT INTO "CptTauxTca" ("id","branche","produitCode","natureContrat","taux","dateEffet","creeParId") VALUES ('t4b','ACCIDENTS','P1','GROUPE',0.1,'2026-01-01','u-test')$q$, 'CptTauxTca_unique_portee_date');
SELECT pg_temp.doit_reussir('taux : 0 % accepté (décès)', $q$INSERT INTO "CptTauxTca" ("id","branche","taux","dateEffet","creeParId") VALUES ('t5','DECES',0,'2026-01-01','u-test')$q$);
SELECT pg_temp.doit_echouer('taux : supérieur à 100 % refusé', $q$INSERT INTO "CptTauxTca" ("id","branche","taux","dateEffet","creeParId") VALUES ('t6','SANTE',1.5,'2026-01-01','u-test')$q$, 'CptTauxTca_taux_check');
SELECT pg_temp.doit_echouer('taux : négatif refusé', $q$INSERT INTO "CptTauxTca" ("id","branche","taux","dateEffet","creeParId") VALUES ('t7','SANTE',-0.01,'2026-01-01','u-test')$q$, 'CptTauxTca_taux_check');
SELECT pg_temp.doit_echouer('taux : produit inconnu refusé', $q$INSERT INTO "CptTauxTca" ("id","branche","produitCode","taux","dateEffet","creeParId") VALUES ('t8','SANTE','INCONNU',0.04,'2026-01-01','u-test')$q$, 'CptTauxTca_produitCode_fkey');
SELECT pg_temp.doit_echouer('taux : UPDATE toujours interdit (jamais modifié)', $q$UPDATE "CptTauxTca" SET "taux" = 0.05 WHERE "id" = 't1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('taux : DELETE accepté avant la mise en service', $q$DELETE FROM "CptTauxTca" WHERE "id" = 't5'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Conventions : seule la date de fin change
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('convention : création', $q$INSERT INTO "CptConvention" ("id","partenaireId","produitCode","nature","taux","base","faitGenerateur","modeReglement","dateEffet","creeParId") VALUES ('c1','p-a','P1','COMMISSION',0.15,'PRIME_NETTE','ENCAISSEMENT','AU_PRORATA','2026-01-01','u-test')$q$);
SELECT pg_temp.doit_reussir('convention : clôture par la date de fin', $q$UPDATE "CptConvention" SET "dateFin" = '2026-12-31' WHERE "id" = 'c1'$q$);
SELECT pg_temp.doit_echouer('convention : le taux ne se modifie pas', $q$UPDATE "CptConvention" SET "taux" = 0.2 WHERE "id" = 'c1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('convention : la date d''effet ne se modifie pas', $q$UPDATE "CptConvention" SET "dateEffet" = '2025-01-01' WHERE "id" = 'c1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('convention : fin avant le début refusée', $q$UPDATE "CptConvention" SET "dateFin" = '2025-12-31' WHERE "id" = 'c1'$q$, 'CptConvention_periode_check');
SELECT pg_temp.doit_echouer('convention : taux supérieur à 100 % refusé', $q$INSERT INTO "CptConvention" ("id","partenaireId","nature","taux","base","faitGenerateur","modeReglement","dateEffet","creeParId") VALUES ('c2','p-a','COMMISSION',2,'TTC','EMISSION','EN_UNE_FOIS','2026-01-01','u-test')$q$, 'CptConvention_taux_check');
SELECT pg_temp.doit_echouer('convention : partenaire inconnu refusé', $q$INSERT INTO "CptConvention" ("id","partenaireId","nature","taux","base","faitGenerateur","modeReglement","dateEffet","creeParId") VALUES ('c3','inconnu','COMMISSION',0.1,'TTC','EMISSION','EN_UNE_FOIS','2026-01-01','u-test')$q$, 'CptConvention_partenaireId_fkey');
SELECT pg_temp.doit_echouer('produit référencé par une convention : suppression refusée', $q$DELETE FROM "CptProduit" WHERE "code" = 'P1'$q$, 'violates foreign key constraint');
SELECT pg_temp.doit_echouer('partenaire référencé par une convention : suppression refusée', $q$DELETE FROM "CptPartenaire" WHERE "id" = 'p-a'$q$, 'CptConvention_partenaireId_fkey');
SELECT pg_temp.doit_reussir('convention : DELETE accepté avant la mise en service', $q$INSERT INTO "CptConvention" ("id","partenaireId","nature","taux","base","faitGenerateur","modeReglement","dateEffet","creeParId") VALUES ('c4','p-b','HONORAIRES',0.05,'TTC','EMISSION','EN_UNE_FOIS','2026-01-01','u-test'); DELETE FROM "CptConvention" WHERE "id" = 'c4'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Après la mise en service : plus de suppression, la clôture d'une convention reste possible
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ('u-test', 'sha-synthetique');
SELECT pg_temp.doit_echouer('taux : DELETE interdit après la mise en service', $q$DELETE FROM "CptTauxTca" WHERE "id" = 't2'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('taux : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptTauxTca"$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('convention : DELETE interdit après la mise en service', $q$DELETE FROM "CptConvention" WHERE "id" = 'c1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('convention : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptConvention" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('convention : la date de fin reste modifiable après la mise en service', $q$UPDATE "CptConvention" SET "dateFin" = '2027-06-30' WHERE "id" = 'c1'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Indépendance : aucun trigger de ces tables n'utilise une fonction d'un autre module
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('indépendance : triggers des référentiels = fonctions cpt_*', $q$
  DO $d$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND c.relname IN ('CptTauxTca','CptConvention') AND p.proname NOT LIKE 'cpt\_%'
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
    RAISE EXCEPTION 'GC-2a : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
  RAISE NOTICE 'GC-2a : % contrôles réussis, 0 échec', n_total;
END;
$$;
