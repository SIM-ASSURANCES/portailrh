-- Gestion Compta, lot GC-1a : vérifie les contraintes et les triggers du socle technique (migration
-- 20261101090000_compta_socle_technique). À exécuter UNIQUEMENT sur une base jetable (voir compta-gc1a-schema.sh).
-- Données 100 % synthétiques. Échec = exception finale (code de sortie non nul avec ON_ERROR_STOP).

CREATE TEMP TABLE resultats (nom text NOT NULL, ok boolean NOT NULL, detail text);

-- Doit RÉUSSIR.
CREATE FUNCTION pg_temp.doit_reussir(p_nom text, p_requete text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_requete;
  INSERT INTO resultats VALUES (p_nom, true, NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO resultats VALUES (p_nom, false, 'erreur inattendue : ' || SQLERRM);
END;
$$;

-- Doit ÉCHOUER avec un message contenant p_attendu.
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

-- Jeu minimal : un rôle et un compte (les clés étrangères vers User sont en Restrict).
INSERT INTO "Role" ("id", "name") VALUES ('r-test', 'Rôle de test');
INSERT INTO "User" ("id", "fullName", "email", "roleId", "updatedAt")
  VALUES ('u-test', 'Compte de test', 'compta-gc1a@simassurances.test', 'r-test', now());

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. CptAudit (ajout seul) AVANT la mise en service
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('audit : INSERT', $q$INSERT INTO "CptAudit" ("entite","entiteId","action","userId") VALUES ('Test','1','creation','u-test')$q$);
SELECT pg_temp.doit_echouer('audit : UPDATE toujours interdit', $q$UPDATE "CptAudit" SET "action" = 'modif'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('audit : DELETE accepté avant la mise en service', $q$DELETE FROM "CptAudit"$q$);
SELECT pg_temp.doit_reussir('audit : TRUNCATE accepté avant la mise en service', $q$TRUNCATE "CptAudit"$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. CptPeriode : mois entier, cohérence de clôture, période clôturée définitive
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('période : INSERT du 1er du mois', $q$INSERT INTO "CptPeriode" ("id","mois") VALUES ('p-sept','2026-09-01')$q$);
SELECT pg_temp.doit_echouer('période : un jour autre que le 1er est refusé', $q$INSERT INTO "CptPeriode" ("id","mois") VALUES ('p-mid','2026-10-15')$q$, 'CptPeriode_mois_premier_jour');
SELECT pg_temp.doit_echouer('période : un mois ne peut exister deux fois', $q$INSERT INTO "CptPeriode" ("id","mois") VALUES ('p-dup','2026-09-01')$q$, 'CptPeriode_mois_key');
SELECT pg_temp.doit_echouer('période : clôture sans auteur refusée', $q$UPDATE "CptPeriode" SET "statut"='CLOTUREE', "clotureeAt"=now() WHERE "id"='p-sept'$q$, 'CptPeriode_cloture_coherente');
SELECT pg_temp.doit_echouer('période : ouverte avec une date de clôture refusée', $q$UPDATE "CptPeriode" SET "clotureeAt"=now() WHERE "id"='p-sept'$q$, 'CptPeriode_cloture_coherente');
SELECT pg_temp.doit_reussir('période : clôture complète acceptée', $q$UPDATE "CptPeriode" SET "statut"='CLOTUREE', "clotureeAt"=now(), "clotureeParId"='u-test' WHERE "id"='p-sept'$q$);
SELECT pg_temp.doit_echouer('période : une période clôturée ne se rouvre pas', $q$UPDATE "CptPeriode" SET "statut"='OUVERTE', "clotureeAt"=NULL, "clotureeParId"=NULL WHERE "id"='p-sept'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('période : une période clôturée ne se supprime pas', $q$DELETE FROM "CptPeriode" WHERE "id"='p-sept'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('période : une période ouverte se supprime', $q$INSERT INTO "CptPeriode" ("id","mois") VALUES ('p-oct','2026-10-01'); DELETE FROM "CptPeriode" WHERE "id"='p-oct'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. CptSequence avant la mise en service (librement ajustable : recette)
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('séquence : INSERT', $q$INSERT INTO "CptSequence" ("cle","valeur") VALUES ('CPE-2026', 5)$q$);
SELECT pg_temp.doit_reussir('séquence : baisse acceptée avant la mise en service', $q$UPDATE "CptSequence" SET "valeur" = 2 WHERE "cle" = 'CPE-2026'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. CptMiseEnService : ligne unique, jamais modifiée ni supprimée
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_echouer('mise en service : seul id = 1 est possible', $q$INSERT INTO "CptMiseEnService" ("id","activeeParId","sauvegardeSha256") VALUES (2,'u-test','abc')$q$, 'CptMiseEnService_ligne_unique');
SELECT pg_temp.doit_reussir('mise en service : INSERT de la ligne unique', $q$INSERT INTO "CptMiseEnService" ("activeeParId","sauvegardeSha256") VALUES ('u-test','sha-synthetique')$q$);
SELECT pg_temp.doit_echouer('mise en service : UPDATE interdit', $q$UPDATE "CptMiseEnService" SET "sauvegardeSha256" = 'autre'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('mise en service : DELETE interdit', $q$DELETE FROM "CptMiseEnService"$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('mise en service : TRUNCATE interdit', $q$TRUNCATE "CptMiseEnService"$q$, 'CPT_IMMUABLE');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. APRÈS la mise en service
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('audit : INSERT reste possible', $q$INSERT INTO "CptAudit" ("entite","entiteId","action","userId") VALUES ('Test','2','creation','u-test')$q$);
SELECT pg_temp.doit_echouer('audit : DELETE interdit après la mise en service', $q$DELETE FROM "CptAudit"$q$, 'après la mise en service');
SELECT pg_temp.doit_echouer('audit : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptAudit"$q$, 'après la mise en service');
SELECT pg_temp.doit_echouer('audit : UPDATE toujours interdit', $q$UPDATE "CptAudit" SET "motif" = 'x'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('séquence : hausse acceptée', $q$UPDATE "CptSequence" SET "valeur" = 3 WHERE "cle" = 'CPE-2026'$q$);
SELECT pg_temp.doit_echouer('séquence : baisse interdite après la mise en service', $q$UPDATE "CptSequence" SET "valeur" = 1 WHERE "cle" = 'CPE-2026'$q$, 'baisse ou renommage');
SELECT pg_temp.doit_echouer('séquence : renommage interdit', $q$UPDATE "CptSequence" SET "cle" = 'CPE-2027' WHERE "cle" = 'CPE-2026'$q$, 'baisse ou renommage');
SELECT pg_temp.doit_echouer('séquence : DELETE interdit', $q$DELETE FROM "CptSequence" WHERE "cle" = 'CPE-2026'$q$, 'suppression de la séquence');
SELECT pg_temp.doit_echouer('séquence : TRUNCATE interdit', $q$TRUNCATE "CptSequence"$q$, 'après la mise en service');
SELECT pg_temp.doit_echouer('période : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptPeriode"$q$, 'après la mise en service');

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Indépendance vis-à-vis d'Encaissements (décision V1) : aucun croisement entre fonctions enc_* et cpt_*
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO resultats
SELECT 'indépendance : aucun trigger Cpt* n''utilise une fonction enc_*',
       count(*) = 0, 'triggers fautifs : ' || count(*)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal AND c.relname LIKE 'Cpt%' AND p.proname LIKE 'enc\_%';

INSERT INTO resultats
SELECT 'indépendance : aucun trigger Enc* n''utilise une fonction cpt_*',
       count(*) = 0, 'triggers fautifs : ' || count(*)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal AND c.relname LIKE 'Enc%' AND p.proname LIKE 'cpt\_%';

INSERT INTO resultats
SELECT 'indépendance : les fonctions enc_* existantes sont toujours présentes (3)',
       count(*) = 3, 'trouvées : ' || count(*)
FROM pg_proc WHERE proname IN ('enc_interdire', 'enc_interdire_apres_mise_en_service', 'enc_sequence_garde');

INSERT INTO resultats
SELECT 'fonctions cpt_* créées (4)', count(*) = 4, 'trouvées : ' || count(*)
FROM pg_proc WHERE proname IN ('cpt_interdire', 'cpt_interdire_apres_mise_en_service', 'cpt_sequence_garde', 'cpt_periode_garde');

-- ---------------------------------------------------------------------------------------------------------------------
-- Bilan
-- ---------------------------------------------------------------------------------------------------------------------
SELECT CASE WHEN ok THEN 'OK ' ELSE 'KO ' END || nom || coalesce('  -> ' || detail, '') AS resultat FROM resultats;

DO $$
DECLARE n_ko int; n_total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO n_ko, n_total FROM resultats;
  IF n_ko > 0 THEN
    RAISE EXCEPTION 'GC-1a : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
  RAISE NOTICE 'GC-1a : % contrôles réussis, 0 échec', n_total;
END;
$$;
