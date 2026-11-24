-- Gestion Compta, lot GC-4a : vérifie les contraintes et les triggers des encaissements et relevés (migration
-- 20261101180000_compta_encaissements). À exécuter UNIQUEMENT sur une base jetable FRAÎCHE (voir compta-gc1a-schema.sh, étape 11) :
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
  VALUES ('u-test', 'Compte de test', 'compta-gc4a@simassurances.test', 'r-test', now());
INSERT INTO "CptCompte" ("id", "libelle", "type", "majAt")
  VALUES ('co-wave', 'Wave Business', 'WAVE_BUSINESS', now()), ('co-bni', 'BNI', 'BANQUE', now()), ('co-caisse', 'Caisse', 'CAISSE', now());
INSERT INTO "CptPieceJointe" ("id", "url", "mime", "taille", "sha256", "deposeeParId")
  VALUES ('pj-1', 'uploads/a.csv', 'text/csv', 10, 'aaa', 'u-test'), ('pj-2', 'uploads/b.csv', 'text/csv', 10, 'bbb', 'u-test');
INSERT INTO "CptImport" ("id", "type", "fichierId", "empreinte", "compteId", "periode", "creeParId")
  VALUES ('i1', 'RELEVE_WAVE_BUSINESS', 'pj-1', 'emp-1', 'co-wave', '2026-03-01', 'u-test'),
         ('i2', 'RELEVE_WAVE_BUSINESS', 'pj-2', 'emp-2', 'co-wave', '2026-03-01', 'u-test');

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Relevés
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('relevé : création', $q$INSERT INTO "CptReleve" ("id","importId","compteId","periode","nbLignes","totalCredits","totalFrais") VALUES ('rel1','i1','co-wave','2026-03-01',4,500000,5000)$q$);
SELECT pg_temp.doit_echouer('relevé : un seul relevé par import', $q$INSERT INTO "CptReleve" ("id","importId","compteId","periode","nbLignes","totalCredits") VALUES ('rel2','i1','co-wave','2026-03-01',1,1)$q$, 'CptReleve_importId_key');
SELECT pg_temp.doit_echouer('relevé : période qui n''est pas le premier du mois refusée', $q$INSERT INTO "CptReleve" ("id","importId","compteId","periode","nbLignes","totalCredits") VALUES ('rel3','i2','co-wave','2026-03-10',1,1)$q$, 'CptReleve_periode_check');
SELECT pg_temp.doit_echouer('relevé : total négatif refusé', $q$INSERT INTO "CptReleve" ("id","importId","compteId","periode","nbLignes","totalCredits") VALUES ('rel4','i2','co-wave','2026-03-01',1,-1)$q$, 'CptReleve_totaux_check');
SELECT pg_temp.doit_reussir('relevé : second relevé du même mois pour un autre import (export partiel)', $q$INSERT INTO "CptReleve" ("id","importId","compteId","periode","nbLignes","totalCredits") VALUES ('rel5','i2','co-wave','2026-03-01',2,100000)$q$);
SELECT pg_temp.doit_echouer('relevé : jamais modifié', $q$UPDATE "CptReleve" SET "nbLignes" = 99 WHERE id = 'rel1'$q$, 'CPT_IMMUABLE');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Encaissements : identité, montants, statut
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('encaissement : crédit à rattacher', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","releveId","ligneReleve","creeParId","majAt") VALUES ('e1','CPE-2026-000001','co-wave','T_ABC1234567',DATE '2026-03-02',100000,'ENCAISSEMENT',100000,'rel1',1,'u-test',now())$q$);
SELECT pg_temp.doit_reussir('encaissement : valeurs par défaut', $q$DO $d$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CptEncaissement" WHERE id = 'e1' AND statut = 'A_RATTACHER' AND frais = 0 AND "montantPasUnePrime" = 0 AND reprise = false) THEN RAISE EXCEPTION 'défauts incorrects'; END IF; END $d$$q$);
SELECT pg_temp.doit_echouer('encaissement : la même ligne de relevé deux fois (même compte, même référence) refusée (RG-04, T9)', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e2','CPE-2026-000002','co-wave','T_ABC1234567',DATE '2026-03-02',100000,'ENCAISSEMENT',100000,'u-test',now())$q$, 'CptEncaissement_compteId_referenceReleve_key');
SELECT pg_temp.doit_reussir('encaissement : même référence sur un AUTRE compte acceptée', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e3','CPE-2026-000003','co-bni','T_ABC1234567',DATE '2026-03-03',100000,'ENCAISSEMENT',100000,'u-test',now())$q$);
SELECT pg_temp.doit_echouer('encaissement : identifiant métier unique', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e4','CPE-2026-000001','co-bni','AUTRE',DATE '2026-03-03',1,'ENCAISSEMENT',1,'u-test',now())$q$, 'CptEncaissement_reference_key');
SELECT pg_temp.doit_echouer('encaissement : montant négatif refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e5','CPE-2026-000005','co-bni','N1',DATE '2026-03-03',-1,'ENCAISSEMENT',0,'u-test',now())$q$, 'CptEncaissement_montants_check');
SELECT pg_temp.doit_echouer('encaissement : reste à rattacher supérieur au montant refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e6','CPE-2026-000006','co-bni','N2',DATE '2026-03-03',100,'ENCAISSEMENT',101,'u-test',now())$q$, 'CptEncaissement_montants_check');
SELECT pg_temp.doit_echouer('encaissement : reste + part « pas une prime » supérieurs au montant refusés', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","montantPasUnePrime","motifPasUnePrime","creeParId","majAt") VALUES ('e7','CPE-2026-000007','co-bni','N3',DATE '2026-03-03',100,'ENCAISSEMENT',60,50,'frais','u-test',now())$q$, 'CptEncaissement_montants_check');
SELECT pg_temp.doit_echouer('encaissement : type de flux inconnu refusé par l''enum', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e8','CPE-2026-000008','co-bni','N4',DATE '2026-03-03',1,'PRIME',1,'u-test',now())$q$, 'CptTypeFlux');
SELECT pg_temp.doit_echouer('encaissement : compte inconnu refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('e9','CPE-2026-000009','inconnu','N5',DATE '2026-03-03',1,'ENCAISSEMENT',1,'u-test',now())$q$, 'CptEncaissement_compteId_fkey');

-- Un crédit est « à rattacher » ou « soldé » ; toute autre ligne est « sans objet », sans reste ni part « pas une prime ».
SELECT pg_temp.doit_reussir('remboursement : sans objet, reste nul', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt") VALUES ('f1','CPE-2026-000011','co-wave','T_REMB0000001',DATE '2026-03-04',2000,'REMBOURSEMENT','SANS_OBJET',0,'u-test',now())$q$);
SELECT pg_temp.doit_echouer('remboursement « à rattacher » refusé (statut incohérent avec le type)', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt") VALUES ('f2','CPE-2026-000012','co-wave','T_REMB0000002',DATE '2026-03-04',2000,'REMBOURSEMENT','A_RATTACHER',2000,'u-test',now())$q$, 'CptEncaissement_statut_type_check');
SELECT pg_temp.doit_echouer('crédit « sans objet » refusé (statut incohérent avec le type)', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt") VALUES ('f3','CPE-2026-000013','co-wave','T_CRED0000001',DATE '2026-03-04',2000,'ENCAISSEMENT','SANS_OBJET',0,'u-test',now())$q$, 'CptEncaissement_statut_type_check');
SELECT pg_temp.doit_echouer('ligne sans objet avec un reste refusée', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt") VALUES ('f4','CPE-2026-000014','co-wave','T_FRAIS000001',DATE '2026-03-04',50,'FRAIS','SANS_OBJET',50,'u-test',now())$q$, 'CptEncaissement_sans_objet_check');
SELECT pg_temp.doit_echouer('soldé avec un reste refusé', $q$UPDATE "CptEncaissement" SET statut = 'SOLDE' WHERE id = 'e1'$q$, 'CptEncaissement_solde_check');

-- RG-03 : « pas une prime » exige un motif écrit. T1 : 4 500 payés, 2 500 rattachés, 2 000 de frais de carte « pas une prime ».
SELECT pg_temp.doit_reussir('T1 : 4 500 = 2 500 rattachés + 2 000 pas une prime (avec motif)', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","montantPasUnePrime","motifPasUnePrime","creeParId","majAt") VALUES ('t1','CPE-2026-000021','co-wave','T_RELAX00001',DATE '2026-03-05',4500,'ENCAISSEMENT',2500,2000,'Frais de carte santé','u-test',now())$q$);
SELECT pg_temp.doit_echouer('pas une prime sans motif refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","montantPasUnePrime","creeParId","majAt") VALUES ('t2','CPE-2026-000022','co-wave','T_RELAX00002',DATE '2026-03-05',4500,'ENCAISSEMENT',2500,2000,'u-test',now())$q$, 'CptEncaissement_motif_check');
SELECT pg_temp.doit_echouer('pas une prime avec un motif d''espaces refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","montantPasUnePrime","motifPasUnePrime","creeParId","majAt") VALUES ('t3','CPE-2026-000023','co-wave','T_RELAX00003',DATE '2026-03-05',4500,'ENCAISSEMENT',2500,2000,'   ','u-test',now())$q$, 'CptEncaissement_motif_check');

-- Une ligne de relevé a un relevé ET un rang ; un chèque ou un reçu de caisse n'a ni l'un ni l'autre.
SELECT pg_temp.doit_echouer('relevé sans rang refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","releveId","creeParId","majAt") VALUES ('l1','CPE-2026-000031','co-wave','T_LIGNE00001',DATE '2026-03-06',1,'ENCAISSEMENT',1,'rel1','u-test',now())$q$, 'CptEncaissement_ligne_check');
SELECT pg_temp.doit_echouer('rang sans relevé refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","ligneReleve","creeParId","majAt") VALUES ('l2','CPE-2026-000032','co-wave','T_LIGNE00002',DATE '2026-03-06',1,'ENCAISSEMENT',1,3,'u-test',now())$q$, 'CptEncaissement_ligne_check');
SELECT pg_temp.doit_echouer('rang zéro refusé', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","releveId","ligneReleve","creeParId","majAt") VALUES ('l3','CPE-2026-000033','co-wave','T_LIGNE00003',DATE '2026-03-06',1,'ENCAISSEMENT',1,'rel1',0,'u-test',now())$q$, 'CptEncaissement_ligne_check');
SELECT pg_temp.doit_reussir('reçu de caisse : ni relevé ni rang', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('l4','CPE-2026-000034','co-caisse','RC-2026-0001',DATE '2026-03-06',25000,'ENCAISSEMENT',25000,'u-test',now())$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Immuabilité d'une ligne d'encaissement
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_echouer('encaissement : le montant ne change jamais', $q$UPDATE "CptEncaissement" SET montant = 1 WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : la date de valeur ne change jamais', $q$UPDATE "CptEncaissement" SET "dateValeur" = DATE '2026-01-01' WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : le compte ne change jamais', $q$UPDATE "CptEncaissement" SET "compteId" = 'co-bni' WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : la référence du relevé ne change jamais', $q$UPDATE "CptEncaissement" SET "referenceReleve" = 'AUTRE' WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : le type de flux ne change jamais', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'TEST' WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : le payeur ne change jamais', $q$UPDATE "CptEncaissement" SET payeur = 'Quelqu''un' WHERE id = 'e1'$q$, 'CPT_IMMUABLE');
-- Exception : un virement interne n'est reconnu que lorsque l'autre côté arrive (relevé de la banque après celui de Wave).
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES
  ('p1','CPE-2026-000061','co-bni','VIR-BNI-P1',DATE '2026-03-07',5000,'ENCAISSEMENT',5000,'u-test',now());
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt") VALUES
  ('p2','CPE-2026-000062','co-wave','T_P2000000001',DATE '2026-03-07',5000,'AUTRE_DEBIT','SANS_OBJET',0,'u-test',now());
SELECT pg_temp.doit_reussir('encaissement : un crédit devient VIREMENT_INTERNE_ENTRANT (rapprochement tardif)', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'VIREMENT_INTERNE_ENTRANT', statut = 'SANS_OBJET', "resteARattacher" = 0 WHERE id = 'p1'$q$);
SELECT pg_temp.doit_reussir('encaissement : un débit devient VIREMENT_INTERNE_SORTANT (rapprochement tardif)', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'VIREMENT_INTERNE_SORTANT' WHERE id = 'p2'$q$);
SELECT pg_temp.doit_echouer('encaissement : un virement ne devient pas une transaction test', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'TEST' WHERE id = 'p2'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : un remboursement ne devient pas un virement ni un autre débit', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'VIREMENT_INTERNE_SORTANT' WHERE id = 'f1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : un virement entrant ne devient pas sortant (le sens est conservé)', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'VIREMENT_INTERNE_SORTANT' WHERE id = 'p1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : un crédit ne devient pas un virement sortant', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'VIREMENT_INTERNE_SORTANT', statut = 'SANS_OBJET', "resteARattacher" = 0 WHERE id = 'e3'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('encaissement : un rapprochement défait rend le crédit à rattacher', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'ENCAISSEMENT', statut = 'A_RATTACHER', "resteARattacher" = 5000 WHERE id = 'p1'$q$);
SELECT pg_temp.doit_echouer('encaissement : un type de flux qui change avec un champ descriptif refusé', $q$UPDATE "CptEncaissement" SET "typeFlux" = 'VIREMENT_INTERNE_ENTRANT', statut = 'SANS_OBJET', "resteARattacher" = 0, montant = 6000 WHERE id = 'p1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('encaissement : le rattachement avance (reste, statut)', $q$UPDATE "CptEncaissement" SET "resteARattacher" = 0, statut = 'SOLDE' WHERE id = 'e1'$q$);
SELECT pg_temp.doit_reussir('encaissement : le classement « pas une prime » avance', $q$UPDATE "CptEncaissement" SET "resteARattacher" = 1000, "montantPasUnePrime" = 1500, "motifPasUnePrime" = 'Complément de frais' WHERE id = 't1'$q$);
SELECT pg_temp.doit_reussir('encaissement : les champs Odoo se renseignent', $q$UPDATE "CptEncaissement" SET "pieceOdoo" = 'BNK/2026/0001', "dateComptabilisation" = DATE '2026-03-31' WHERE id = 'e3'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Virements internes
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","statut","resteARattacher","creeParId","majAt") VALUES
  ('v-out','CPE-2026-000041','co-wave','T_VIR000001',DATE '2026-03-10',300000,'VIREMENT_INTERNE_SORTANT','SANS_OBJET',0,'u-test',now()),
  ('v-in','CPE-2026-000042','co-bni','VIR-BNI-0001',DATE '2026-03-11',300000,'VIREMENT_INTERNE_ENTRANT','SANS_OBJET',0,'u-test',now()),
  ('v-in2','CPE-2026-000043','co-bni','VIR-BNI-0002',DATE '2026-03-11',300000,'VIREMENT_INTERNE_ENTRANT','SANS_OBJET',0,'u-test',now());
SELECT pg_temp.doit_reussir('virement interne : Wave → BNI rapproché (T9)', $q$INSERT INTO "CptTransfertInterne" ("id","encaissementSortantId","encaissementEntrantId","compteSourceId","compteCibleId","creeParId") VALUES ('tr1','v-out','v-in','co-wave','co-bni','u-test')$q$);
SELECT pg_temp.doit_echouer('virement interne : une ligne sortante ne sert qu''une fois', $q$INSERT INTO "CptTransfertInterne" ("id","encaissementSortantId","encaissementEntrantId","compteSourceId","compteCibleId","creeParId") VALUES ('tr2','v-out','v-in2','co-wave','co-bni','u-test')$q$, 'CptTransfertInterne_encaissementSortantId_key');
SELECT pg_temp.doit_echouer('virement interne : une ligne entrante ne sert qu''une fois', $q$INSERT INTO "CptTransfertInterne" ("id","encaissementSortantId","encaissementEntrantId","compteSourceId","compteCibleId","creeParId") VALUES ('tr3','f1','v-in','co-wave','co-bni','u-test')$q$, 'CptTransfertInterne_encaissementEntrantId_key');
SELECT pg_temp.doit_echouer('virement interne : même ligne des deux côtés refusée', $q$INSERT INTO "CptTransfertInterne" ("id","encaissementSortantId","encaissementEntrantId","compteSourceId","compteCibleId","creeParId") VALUES ('tr4','v-in2','v-in2','co-wave','co-bni','u-test')$q$, 'CptTransfertInterne_lignes_check');
SELECT pg_temp.doit_echouer('virement interne : même compte des deux côtés refusé', $q$INSERT INTO "CptTransfertInterne" ("id","encaissementSortantId","encaissementEntrantId","compteSourceId","compteCibleId","creeParId") VALUES ('tr5','f1','v-in2','co-wave','co-wave','u-test')$q$, 'CptTransfertInterne_comptes_check');
SELECT pg_temp.doit_echouer('virement interne : jamais modifié', $q$UPDATE "CptTransfertInterne" SET "compteCibleId" = 'co-caisse' WHERE id = 'tr1'$q$, 'CPT_IMMUABLE');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Chèques
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('chèque : reçu, pas encore remis', $q$INSERT INTO "CptCheque" ("id","dateReception","numero","tireur","montant","creeParId","majAt") VALUES ('c1',DATE '2026-03-12','0012345','SOCIETE TEST',250000,'u-test',now())$q$);
SELECT pg_temp.doit_echouer('chèque : montant nul refusé', $q$INSERT INTO "CptCheque" ("id","dateReception","numero","tireur","montant","creeParId","majAt") VALUES ('c2',DATE '2026-03-12','0012346','SOCIETE TEST',0,'u-test',now())$q$, 'CptCheque_montant_check');
SELECT pg_temp.doit_echouer('chèque remis sans date de remise refusé', $q$UPDATE "CptCheque" SET statut = 'REMIS_EN_BANQUE' WHERE id = 'c1'$q$, 'CptCheque_remise_check');
SELECT pg_temp.doit_echouer('chèque reçu avec une date de remise refusé', $q$UPDATE "CptCheque" SET "dateRemiseBanque" = DATE '2026-03-13' WHERE id = 'c1'$q$, 'CptCheque_remise_check');
SELECT pg_temp.doit_echouer('chèque remis avant sa réception refusé', $q$UPDATE "CptCheque" SET statut = 'REMIS_EN_BANQUE', "dateRemiseBanque" = DATE '2026-03-01' WHERE id = 'c1'$q$, 'CptCheque_remise_check');
SELECT pg_temp.doit_echouer('chèque reçu rattaché à un encaissement refusé', $q$UPDATE "CptCheque" SET "encaissementId" = 'e3' WHERE id = 'c1'$q$, 'CptCheque_encaissement_check');
SELECT pg_temp.doit_reussir('chèque : remis en banque, encaissement créé', $q$UPDATE "CptCheque" SET statut = 'REMIS_EN_BANQUE', "dateRemiseBanque" = DATE '2026-03-13', "encaissementId" = 'e3' WHERE id = 'c1'$q$);
SELECT pg_temp.doit_reussir('chèque : devenu impayé', $q$UPDATE "CptCheque" SET statut = 'IMPAYE' WHERE id = 'c1'$q$);
SELECT pg_temp.doit_echouer('chèque : un encaissement ne correspond qu''à un chèque', $q$INSERT INTO "CptCheque" ("id","encaissementId","dateReception","numero","tireur","montant","dateRemiseBanque","statut","creeParId","majAt") VALUES ('c3','e3',DATE '2026-03-12','0012347','AUTRE',1,DATE '2026-03-13','REMIS_EN_BANQUE','u-test',now())$q$, 'CptCheque_encaissementId_key');

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Suppression : acceptée avant la mise en service
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('encaissement : DELETE accepté avant la mise en service', $q$INSERT INTO "CptEncaissement" ("id","reference","compteId","referenceReleve","dateValeur","montant","typeFlux","resteARattacher","creeParId","majAt") VALUES ('d1','CPE-2026-000051','co-caisse','RC-2026-0002',DATE '2026-03-14',1,'ENCAISSEMENT',1,'u-test',now()); DELETE FROM "CptEncaissement" WHERE id = 'd1'$q$);
SELECT pg_temp.doit_echouer('encaissement lié à un virement : suppression refusée', $q$DELETE FROM "CptEncaissement" WHERE id = 'v-out'$q$, 'violates foreign key constraint');

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Après la mise en service : plus de suppression
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ('u-test', 'sha-synthetique');
SELECT pg_temp.doit_echouer('encaissement : DELETE interdit après la mise en service', $q$DELETE FROM "CptEncaissement" WHERE id = 'l4'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('relevé : DELETE interdit après la mise en service', $q$DELETE FROM "CptReleve" WHERE id = 'rel5'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('virement interne : DELETE interdit après la mise en service', $q$DELETE FROM "CptTransfertInterne" WHERE id = 'tr1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('chèque : DELETE interdit après la mise en service', $q$DELETE FROM "CptCheque" WHERE id = 'c1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('encaissement : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptEncaissement" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('relevé : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptReleve" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('chèque : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptCheque"$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_reussir('encaissement : le rattachement avance encore après la mise en service', $q$UPDATE "CptEncaissement" SET "pieceOdoo" = 'BNK/2026/0002' WHERE id = 'l4'$q$);
SELECT pg_temp.doit_reussir('chèque : son statut avance encore après la mise en service', $q$INSERT INTO "CptCheque" ("id","dateReception","numero","tireur","montant","creeParId","majAt") VALUES ('c9',DATE '2026-03-20','0099999','TIREUR',10,'u-test',now()); UPDATE "CptCheque" SET statut = 'REMIS_EN_BANQUE', "dateRemiseBanque" = DATE '2026-03-21' WHERE id = 'c9'$q$);

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Indépendance : aucun trigger de ces tables n'utilise une fonction d'un autre module
-- ---------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.doit_reussir('indépendance : triggers des encaissements = fonctions cpt_*', $q$
  DO $d$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND c.relname IN ('CptEncaissement','CptReleve','CptTransfertInterne','CptCheque') AND p.proname NOT LIKE 'cpt\_%'
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
    RAISE EXCEPTION 'GC-4a : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
  RAISE NOTICE 'GC-4a : % contrôles réussis, 0 échec', n_total;
END;
$$;
