-- Gestion Compta, lot GC-8a : contraintes et triggers de la taxe (migration 20261126090000_compta_taxe).
-- À exécuter UNIQUEMENT sur une base jetable FRAÎCHE (étape 16 de compta-gc1a-schema.sh). Données 100 % synthétiques.

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

INSERT INTO "Role" ("id", "name") VALUES ('r-test', 'Rôle de test');
INSERT INTO "User" ("id", "fullName", "email", "roleId", "updatedAt") VALUES ('u-test', 'Compte de test', 'compta-gc8a@simassurances.test', 'r-test', now());
INSERT INTO "CptCompte" ("id", "libelle", "type", "majAt") VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now());
INSERT INTO "CptProduit" ("id", "code", "libelle", "branche", "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'ACCIDENTS', now());
INSERT INTO "CptClient" ("id", "nom", "majAt") VALUES ('cl-1', 'Client Un', now());
INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt")
  VALUES ('k1','POL-1','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',2331,2500,'u-test',now());
INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","taxe","montantDu","majAt")
  VALUES ('ec1','k1',1,'2026-01-01','2026-01-31','2026-01-05',2500,2331,169,2500,now());
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt")
  VALUES ('e1','CPE-2026-000001','co-wave','T_AAAAAAAAAA1','2026-02-03',1500,'ENCAISSEMENT',1500,'u-test',now()),
         ('e2','CPE-2026-000002','co-wave','T_AAAAAAAAAA2','2026-02-04',2500,'ENCAISSEMENT',2500,'u-test',now());
INSERT INTO "CptRattachement" ("id","encaissementId","echeanceId","montant","methode","niveauPreuve","statut","justification","valideParId","valideAt","majAt")
  VALUES ('r1','e2','ec1',2500,'REFERENCE_EXACTE','PREUVE','VALIDE','test','u-test',now(),now());

-- 1. Contraintes
SELECT pg_temp.doit_reussir('avance 1 500 à 7,25 % : taxe 101',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "encaissementId", base, "primeHt", taux, montant, "creeParId")
     VALUES ('l-av', 'AVANCE', '2026-02-01', 'e1', 1500, 1399, 0.0725, 101, 'u-test')$q$);
SELECT pg_temp.doit_echouer('une seconde avance sur le même encaissement est refusée',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "encaissementId", base, taux, montant, "creeParId")
     VALUES ('l-av2', 'AVANCE', '2026-02-01', 'e1', 1500, 0.0725, 101, 'u-test')$q$, 'CptLigneTaxe_une_avance_par_encaissement');
SELECT pg_temp.doit_echouer('un mois qui n''est pas le 1er est refusé',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "encaissementId", base, taux, montant, "creeParId")
     VALUES ('l-m', 'AVANCE', '2026-02-15', 'e2', 100, 0.0725, 7, 'u-test')$q$, 'CptLigneTaxe_mois_check');
SELECT pg_temp.doit_echouer('une avance négative est refusée',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "encaissementId", base, taux, montant, "creeParId")
     VALUES ('l-n', 'AVANCE', '2026-02-01', 'e2', 100, 0.0725, -7, 'u-test')$q$, 'CptLigneTaxe_origine_check');
SELECT pg_temp.doit_reussir('taxe du rattachement 2 500 : 169',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "rattachementId", "echeanceId", "encaissementId", base, "primeHt", taux, montant, "creeParId")
     VALUES ('l-ra', 'RATTACHEMENT', '2026-02-01', 'r1', 'ec1', 'e2', 2500, 2331, 0.0725, 169, 'u-test')$q$);
SELECT pg_temp.doit_echouer('un rattachement n''est taxé qu''une fois',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "rattachementId", "echeanceId", base, taux, montant, "creeParId")
     VALUES ('l-ra2', 'RATTACHEMENT', '2026-02-01', 'r1', 'ec1', 2500, 0.0725, 169, 'u-test')$q$, 'CptLigneTaxe_une_par_rattachement');
SELECT pg_temp.doit_echouer('une imputation positive est refusée',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "rattachementId", "ligneAvanceId", "imputeeSurEcheanceId", base, taux, montant, "creeParId")
     VALUES ('l-i', 'IMPUTATION', '2026-02-01', 'r1', 'l-av', 'ec1', 100, 0.0725, 7, 'u-test')$q$, 'CptLigneTaxe_origine_check');
SELECT pg_temp.doit_reussir('imputation négative de l''avance',
  $q$INSERT INTO "CptLigneTaxe" (id, origine, "moisDeclaration", "rattachementId", "ligneAvanceId", "imputeeSurEcheanceId", base, taux, montant, "creeParId")
     VALUES ('l-i', 'IMPUTATION', '2026-02-01', 'r1', 'l-av', 'ec1', -1500, 0.0725, -101, 'u-test')$q$);

-- 2. Déclaration et verrouillage
INSERT INTO "CptDeclarationTca" (id, reference, mois, "montantDu", "montantDejaPaye", "montantAPayer", "nbLignes", "declareParId")
  VALUES ('d1', 'CPD-2026-01', '2026-02-01', 169, 0, 169, 3, 'u-test');
SELECT pg_temp.doit_echouer('un mois ne se déclare qu''une fois',
  $q$INSERT INTO "CptDeclarationTca" (id, reference, mois, "montantDu", "montantDejaPaye", "montantAPayer", "nbLignes", "declareParId")
     VALUES ('d2', 'CPD-2026-02', '2026-02-01', 1, 0, 1, 0, 'u-test')$q$, 'CptDeclarationTca_mois_key');
INSERT INTO "CptDeclarationTca" (id, reference, mois, "montantDu", "montantDejaPaye", "montantAPayer", "nbLignes", "declareParId")
  VALUES ('d0', 'CPD-2026-00', '2026-01-01', 0, 0, 0, 0, 'u-test');
SELECT pg_temp.doit_echouer('une ligne ne peut être déclarée avant son mois',
  $q$UPDATE "CptLigneTaxe" SET "declarationId" = 'd0' WHERE id = 'l-av'$q$, 'CPT_LIGNE_TAXE_MOIS');
SELECT pg_temp.doit_echouer('modifier le montant d''une ligne est refusé',
  $q$UPDATE "CptLigneTaxe" SET montant = 1, "declarationId" = 'd1' WHERE id = 'l-av'$q$, 'CPT_LIGNE_TAXE_IMMUABLE');
SELECT pg_temp.doit_reussir('affecter les lignes à la déclaration',
  $q$UPDATE "CptLigneTaxe" SET "declarationId" = 'd1' WHERE "moisDeclaration" = '2026-02-01'$q$);
SELECT pg_temp.doit_echouer('une ligne déclarée est verrouillée (montant)',
  $q$UPDATE "CptLigneTaxe" SET montant = 5 WHERE id = 'l-ra'$q$, 'CPT_LIGNE_TAXE_VERROUILLEE');
SELECT pg_temp.doit_echouer('une ligne déclarée est verrouillée (déclaration)',
  $q$UPDATE "CptLigneTaxe" SET "declarationId" = 'd0' WHERE id = 'l-ra'$q$, 'CPT_LIGNE_TAXE_VERROUILLEE');
SELECT pg_temp.doit_echouer('une ligne déclarée ne se supprime pas',
  $q$DELETE FROM "CptLigneTaxe" WHERE id = 'l-ra'$q$, 'CPT_LIGNE_TAXE_VERROUILLEE');

-- 3. Paiement
SELECT pg_temp.doit_echouer('PAYEE sans quittance refusée',
  $q$UPDATE "CptDeclarationTca" SET statut = 'PAYEE' WHERE id = 'd1'$q$, 'CptDeclarationTca_paiement_check');
SELECT pg_temp.doit_echouer('les montants d''une déclaration ne changent pas',
  $q$UPDATE "CptDeclarationTca" SET "montantAPayer" = 1 WHERE id = 'd1'$q$, 'CPT_DECLARATION_TCA_IMMUABLE');
SELECT pg_temp.doit_reussir('paiement avec quittance',
  $q$UPDATE "CptDeclarationTca" SET statut='PAYEE', "quittanceNumero"='Q-1', "quittanceDate"='2026-03-10', "quittanceMontant"=169, "datePaiement"='2026-03-10', "payeParId"='u-test', "payeAt"=now() WHERE id='d1'$q$);
SELECT pg_temp.doit_echouer('une déclaration payée ne change plus',
  $q$UPDATE "CptDeclarationTca" SET "pieceOdoo" = 'X' WHERE id = 'd1'$q$, 'CPT_DECLARATION_TCA_PAYEE');

-- 4. Crédits
INSERT INTO "CptCreditTaxe" (id, origine, "declarationId", montant) VALUES ('c1', 'TROP_PAYE', 'd1', 20);
SELECT pg_temp.doit_echouer('un crédit nul est refusé', $q$INSERT INTO "CptCreditTaxe" (id, origine, "declarationId", montant) VALUES ('c2','TROP_PAYE','d1',0)$q$, 'CptCreditTaxe_montant_check');
SELECT pg_temp.doit_echouer('récupérer sans déclaration refusé', $q$UPDATE "CptCreditTaxe" SET statut='RECUPERE' WHERE id='c1'$q$, 'CptCreditTaxe_recupere_check');
SELECT pg_temp.doit_reussir('récupération', $q$UPDATE "CptCreditTaxe" SET statut='RECUPERE', "recupereDansId"='d0', "recupereAt"=now() WHERE id='c1'$q$);
SELECT pg_temp.doit_echouer('un crédit récupéré ne change plus', $q$UPDATE "CptCreditTaxe" SET montant=5 WHERE id='c1'$q$, 'CPT_CREDIT_TAXE');

-- 5. Après la mise en service
INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ('u-test', 'sha-synthetique');
SELECT pg_temp.doit_echouer('déclaration : DELETE interdit après la mise en service', $q$DELETE FROM "CptDeclarationTca" WHERE id='d0'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('crédit : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptCreditTaxe"$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('ligne : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptLigneTaxe"$q$, 'CPT_IMMUABLE');

-- 6. Indépendance
SELECT pg_temp.doit_reussir('indépendance : triggers de la taxe = fonctions cpt_*', $q$
  DO $d$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND c.relname IN ('CptLigneTaxe','CptDeclarationTca','CptCreditTaxe') AND p.proname NOT LIKE 'cpt\_%'
    ) THEN RAISE EXCEPTION 'un trigger Gestion Compta utilise une fonction d''un autre module'; END IF;
  END $d$;
$q$);

SELECT CASE WHEN ok THEN 'OK ' ELSE 'KO ' END || nom || coalesce('  -> ' || detail, '') AS resultat FROM resultats;

DO $$
DECLARE n_ko int; n_total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO n_ko, n_total FROM resultats;
  IF n_ko > 0 THEN
    RAISE EXCEPTION 'GC-8a : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
END $$;
