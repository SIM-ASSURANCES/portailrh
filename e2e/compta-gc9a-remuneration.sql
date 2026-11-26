-- Gestion Compta, lot GC-9a : contraintes et triggers de la rémunération des partenaires (migration 20261128090000_compta_remuneration).
-- À exécuter UNIQUEMENT sur une base jetable FRAÎCHE (étape 19 de compta-gc1a-schema.sh). Données 100 % synthétiques.
-- Les contrôles différés (sommes des affectations) sont forcés par SET CONSTRAINTS ALL IMMEDIATE à la fin de chaque essai.

CREATE TEMP TABLE resultats (nom text NOT NULL, ok boolean NOT NULL, detail text);

CREATE FUNCTION pg_temp.doit_reussir(p_nom text, p_requete text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  EXECUTE p_requete;
  SET CONSTRAINTS ALL IMMEDIATE;
  INSERT INTO resultats VALUES (p_nom, true, NULL);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO resultats VALUES (p_nom, false, 'erreur inattendue : ' || SQLERRM);
END;
$$;

CREATE FUNCTION pg_temp.doit_echouer(p_nom text, p_requete text, p_attendu text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  EXECUTE p_requete;
  SET CONSTRAINTS ALL IMMEDIATE;
  RAISE EXCEPTION 'AUCUN_REFUS';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'AUCUN_REFUS' THEN
    INSERT INTO resultats VALUES (p_nom, false, 'aucune erreur alors qu''un refus était attendu');
  ELSIF position(p_attendu in SQLERRM) > 0 THEN
    INSERT INTO resultats VALUES (p_nom, true, NULL);
  ELSE
    INSERT INTO resultats VALUES (p_nom, false, 'mauvais message : ' || SQLERRM);
  END IF;
END;
$$;

INSERT INTO "Role" ("id", "name") VALUES ('r-test', 'Rôle de test');
INSERT INTO "User" ("id", "fullName", "email", "roleId", "updatedAt") VALUES ('u-test', 'Compte de test', 'compta-gc9a@simassurances.test', 'r-test', now());
INSERT INTO "CptProduit" ("id", "code", "libelle", "branche", "majAt") VALUES ('pr-1', 'P1', 'Produit 1', 'SANTE', now());
INSERT INTO "CptClient" ("id", "nom", "majAt") VALUES ('cl-1', 'Client Un', now());
INSERT INTO "CptPartenaire" ("id", "nom", "majAt") VALUES ('pa-a', 'Courtier A', now()), ('pa-b', 'Gestionnaire B', now());
INSERT INTO "CptConvention" ("id","partenaireId","nature","taux","base","faitGenerateur","modeReglement","dateEffet","creeParId")
  VALUES ('cv-a','pa-a','COMMISSION',0.1,'TTC','EMISSION','AU_PRORATA','2020-01-01','u-test'),
         ('cv-h','pa-a','HONORAIRES',0.05,'TTC','EMISSION','EN_UNE_FOIS','2020-01-01','u-test');
INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","dateEffet","dateEcheance","primeNetteHt","primeTtc","creeParId","majAt")
  VALUES ('k1','POL-1','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',20000,20000,'u-test',now()),
         ('k2','POL-2','pr-1','INDIVIDUEL','cl-1','2026-01-01','2026-12-31',1000,1000,'u-test',now());
INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","majAt")
  VALUES ('ec1','k1',1,'2026-01-01','2026-06-30','2026-01-01',10000,10000,10000,now()),
         ('ec2','k1',2,'2026-07-01','2026-12-31','2026-07-01',10000,10000,10000,now()),
         ('ec3','k2',1,'2026-01-01','2026-12-31','2026-01-01',1000,1000,1000,now());

-- 1. Lignes de rémunération
SELECT pg_temp.doit_reussir('lignes de commission et d''honoraires', $q$INSERT INTO "CptLigneRemuneration" (id,"contratId","echeanceId","partenaireBeneficiaireId",nature,"conventionId",du,"creeParId")
  VALUES ('l1','k1','ec1','pa-a','COMMISSION','cv-a',1000,'u-test'), ('l2','k1','ec2','pa-a','COMMISSION','cv-a',1000,'u-test'), ('lh','k1','ec1','pa-a','HONORAIRES','cv-h',500,'u-test')$q$);
SELECT pg_temp.doit_echouer('une seule ligne par (contrat, échéance, bénéficiaire, nature)', $q$INSERT INTO "CptLigneRemuneration" (id,"contratId","echeanceId","partenaireBeneficiaireId",nature,"conventionId",du,"creeParId")
  VALUES ('lx','k1','ec1','pa-a','COMMISSION','cv-a',1,'u-test')$q$, 'CptLigneRemuneration_contratId_echeanceId');
SELECT pg_temp.doit_echouer('l''échéance doit être celle du contrat', $q$INSERT INTO "CptLigneRemuneration" (id,"contratId","echeanceId","partenaireBeneficiaireId",nature,"conventionId",du,"creeParId")
  VALUES ('lx','k1','ec3','pa-a','COMMISSION','cv-a',1,'u-test')$q$, 'CPT_LIGNE_REMUNERATION_CONTRAT');
SELECT pg_temp.doit_echouer('un dû négatif est refusé', $q$INSERT INTO "CptLigneRemuneration" (id,"contratId","echeanceId","partenaireBeneficiaireId",nature,"conventionId",du,"creeParId")
  VALUES ('lx','k2','ec3','pa-a','COMMISSION','cv-a',-1,'u-test')$q$, 'CptLigneRemuneration_du_check');
SELECT pg_temp.doit_echouer('une ligne ne se modifie pas', $q$UPDATE "CptLigneRemuneration" SET du = 5 WHERE id = 'l1'$q$, 'CPT_REMUNERATION_IMMUABLE');

-- 2. Règlements et affectations
SELECT pg_temp.doit_echouer('un règlement sans affectation est refusé à la validation de la transaction', $q$INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","creeParId")
  VALUES ('r0','CPR-2026-000900','pa-a','COMMISSION',100,'2026-02-01','VIREMENT','V-0','u-test')$q$, 'CPT_REGLEMENT_AFFECTATIONS');
SELECT pg_temp.doit_echouer('Σ des affectations différente du montant : refusée', $q$DO $d$ BEGIN
  INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","creeParId")
    VALUES ('r0','CPR-2026-000900','pa-a','COMMISSION',100,'2026-02-01','VIREMENT','V-0','u-test');
  INSERT INTO "CptAffectationReglement" (id,"reglementId","ligneRemunerationId",montant) VALUES ('a0','r0','l1',90);
END $d$$q$, 'CPT_REGLEMENT_AFFECTATIONS');
SELECT pg_temp.doit_reussir('règlement 1 500 affecté 1 000 + 500', $q$DO $d$ BEGIN
  INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","creeParId")
    VALUES ('r1','CPR-2026-000001','pa-a','COMMISSION',1500,'2026-02-01','VIREMENT','V-1','u-test');
  INSERT INTO "CptAffectationReglement" (id,"reglementId","ligneRemunerationId",montant) VALUES ('a1','r1','l1',1000), ('a2','r1','l2',500);
END $d$$q$);
SELECT pg_temp.doit_echouer('montant nul refusé', $q$INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","creeParId")
  VALUES ('rz','CPR-2026-000901','pa-a','COMMISSION',0,'2026-02-01','VIREMENT','V-Z','u-test')$q$, 'CptReglementPartenaire_montant_check');
SELECT pg_temp.doit_echouer('nature obligatoire', $q$INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",montant,date,mode,"referenceReglement","creeParId")
  VALUES ('rz','CPR-2026-000901','pa-a',10,'2026-02-01','VIREMENT','V-Z','u-test')$q$, 'null value in column "nature"');
SELECT pg_temp.doit_echouer('avance sans motif refusée', $q$INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","montantAvance","creeParId")
  VALUES ('rz','CPR-2026-000901','pa-a','COMMISSION',10,'2026-02-01','VIREMENT','V-Z',10,'u-test')$q$, 'CptReglementPartenaire_motif_check');
SELECT pg_temp.doit_echouer('choix « en une fois » sur un règlement sans motif refusé', $q$INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","modeDerogation","creeParId")
  VALUES ('rz','CPR-2026-000901','pa-a','COMMISSION',10,'2026-02-01','VIREMENT','V-Z','EN_UNE_FOIS','u-test')$q$, 'CptReglementPartenaire_motif_check');
SELECT pg_temp.doit_echouer('affectation sur une autre nature refusée', $q$INSERT INTO "CptAffectationReglement" (id,"reglementId","ligneRemunerationId",montant) VALUES ('ax','r1','lh',1)$q$, 'CPT_AFFECTATION_NATURE');
SELECT pg_temp.doit_echouer('ajouter une affectation à un règlement déjà complet est refusé', $q$DO $d$ BEGIN
  INSERT INTO "CptLigneRemuneration" (id,"contratId","echeanceId","partenaireBeneficiaireId",nature,"conventionId",du,"creeParId") VALUES ('l3','k2','ec3','pa-a','COMMISSION','cv-a',100,'u-test');
  INSERT INTO "CptAffectationReglement" (id,"reglementId","ligneRemunerationId",montant) VALUES ('ax','r1','l3',1);
END $d$$q$, 'CPT_REGLEMENT_AFFECTATIONS');
SELECT pg_temp.doit_echouer('payé au-delà du dû d''une ligne refusé', $q$DO $d$ BEGIN
  INSERT INTO "CptReglementPartenaire" (id,reference,"partenaireId",nature,montant,date,mode,"referenceReglement","creeParId")
    VALUES ('r2','CPR-2026-000002','pa-a','COMMISSION',1,'2026-02-02','VIREMENT','V-2','u-test');
  INSERT INTO "CptAffectationReglement" (id,"reglementId","ligneRemunerationId",montant) VALUES ('a3','r2','l1',1);
END $d$$q$, 'CPT_LIGNE_REMUNERATION_PAYE');
SELECT pg_temp.doit_echouer('un règlement ne se modifie pas', $q$UPDATE "CptReglementPartenaire" SET montant = 1600 WHERE id = 'r1'$q$, 'CPT_REMUNERATION_IMMUABLE');
SELECT pg_temp.doit_echouer('une affectation ne se modifie pas', $q$UPDATE "CptAffectationReglement" SET montant = 1 WHERE id = 'a1'$q$, 'CPT_REMUNERATION_IMMUABLE');
SELECT pg_temp.doit_echouer('supprimer une affectation seule casse la somme : refusé', $q$DELETE FROM "CptAffectationReglement" WHERE id = 'a2'$q$, 'CPT_REGLEMENT_AFFECTATIONS');
SELECT pg_temp.doit_reussir('pièce Odoo vide puis renseignée une fois', $q$UPDATE "CptReglementPartenaire" SET "pieceOdoo" = 'OD-1', "dateComptabilisation" = '2026-02-03' WHERE id = 'r1'$q$);
SELECT pg_temp.doit_echouer('pièce Odoo déjà renseignée : plus de modification', $q$UPDATE "CptReglementPartenaire" SET "pieceOdoo" = 'OD-2' WHERE id = 'r1'$q$, 'CPT_REMUNERATION_IMMUABLE');

-- 3. Décisions de mode de règlement
SELECT pg_temp.doit_reussir('décision avec motif', $q$INSERT INTO "CptDecisionModeRemuneration" (id,"contratId","partenaireId",nature,mode,motif,"creeParId") VALUES ('dm1','k1','pa-a','COMMISSION','EN_UNE_FOIS','Accord écrit du courtier','u-test')$q$);
SELECT pg_temp.doit_echouer('décision au motif trop court refusée', $q$INSERT INTO "CptDecisionModeRemuneration" (id,"contratId","partenaireId",nature,mode,motif,"creeParId") VALUES ('dm2','k1','pa-a','COMMISSION','AU_PRORATA','court   ','u-test')$q$, 'CptDecisionModeRemuneration_motif_check');
SELECT pg_temp.doit_echouer('une décision ne se modifie pas', $q$UPDATE "CptDecisionModeRemuneration" SET mode = 'AU_PRORATA' WHERE id = 'dm1'$q$, 'CPT_REMUNERATION_IMMUABLE');

-- 4. Compensations (l'avance de la commission vers les honoraires)
SELECT pg_temp.doit_reussir('compensation 300 : reprise sur la commission, ajout aux honoraires', $q$DO $d$ BEGIN
  INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c1','pa-a','COMMISSION','HONORAIRES',300,'Compensation convenue avec le courtier','u-test');
  INSERT INTO "CptAffectationCompensation" (id,"compensationId","ligneRemunerationId",montant) VALUES ('ac1','c1','l1',-300), ('ac2','c1','lh',300);
END $d$$q$);
SELECT pg_temp.doit_echouer('compensation entre une même nature refusée', $q$INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c2','pa-a','COMMISSION','COMMISSION',1,'Motif assez long ici','u-test')$q$, 'CptCompensation_natures_check');
SELECT pg_temp.doit_echouer('compensation au motif trop court refusée', $q$INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c2','pa-a','COMMISSION','HONORAIRES',1,'trop bref','u-test')$q$, 'CptCompensation_motif_check');
SELECT pg_temp.doit_echouer('compensation sans affectations refusée', $q$INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c2','pa-a','COMMISSION','HONORAIRES',1,'Motif assez long ici','u-test')$q$, 'CPT_COMPENSATION_AFFECTATIONS');
SELECT pg_temp.doit_echouer('compensation déséquilibrée refusée', $q$DO $d$ BEGIN
  INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c2','pa-a','COMMISSION','HONORAIRES',100,'Motif assez long ici','u-test');
  INSERT INTO "CptAffectationCompensation" (id,"compensationId","ligneRemunerationId",montant) VALUES ('ac3','c2','l1',-100), ('ac4','c2','lh',90);
END $d$$q$, 'CPT_COMPENSATION_AFFECTATIONS');
SELECT pg_temp.doit_echouer('reprise sur la nature cible refusée', $q$DO $d$ BEGIN
  INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c2','pa-a','COMMISSION','HONORAIRES',10,'Motif assez long ici','u-test');
  INSERT INTO "CptAffectationCompensation" (id,"compensationId","ligneRemunerationId",montant) VALUES ('ac3','c2','lh',-10), ('ac4','c2','l1',10);
END $d$$q$, 'CPT_COMPENSATION_NATURE');
SELECT pg_temp.doit_echouer('reprendre plus que le payé d''une ligne refusé (payé négatif)', $q$DO $d$ BEGIN
  INSERT INTO "CptCompensation" (id,"partenaireId","natureSource","natureCible",montant,motif,"valideeParId") VALUES ('c2','pa-a','HONORAIRES','COMMISSION',400,'Motif assez long ici','u-test');
  INSERT INTO "CptAffectationCompensation" (id,"compensationId","ligneRemunerationId",montant) VALUES ('ac3','c2','lh',-400), ('ac4','c2','l2',400);
END $d$$q$, 'CPT_LIGNE_REMUNERATION_PAYE');
SELECT pg_temp.doit_echouer('une compensation ne se modifie pas', $q$UPDATE "CptCompensation" SET montant = 1 WHERE id = 'c1'$q$, 'CPT_REMUNERATION_IMMUABLE');
SELECT pg_temp.doit_echouer('l''effet d''une compensation ne se modifie pas', $q$UPDATE "CptAffectationCompensation" SET montant = 1 WHERE id = 'ac2'$q$, 'CPT_REMUNERATION_IMMUABLE');

-- 5. Après la mise en service
INSERT INTO "CptMiseEnService" ("activeeParId", "sauvegardeSha256") VALUES ('u-test', 'sha-synthetique');
SELECT pg_temp.doit_echouer('règlement : DELETE interdit après la mise en service', $q$DELETE FROM "CptReglementPartenaire" WHERE id='r1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('affectation : DELETE interdit après la mise en service', $q$DELETE FROM "CptAffectationReglement" WHERE id='a1'$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('compensation : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptCompensation" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('ligne : TRUNCATE interdit après la mise en service', $q$TRUNCATE "CptLigneRemuneration" CASCADE$q$, 'CPT_IMMUABLE');
SELECT pg_temp.doit_echouer('décision : DELETE interdit après la mise en service', $q$DELETE FROM "CptDecisionModeRemuneration" WHERE id='dm1'$q$, 'CPT_IMMUABLE');

-- 6. Indépendance
SELECT pg_temp.doit_reussir('indépendance : triggers de la rémunération = fonctions cpt_*', $q$
  DO $d$ BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_proc p ON p.oid = tg.tgfoid
      WHERE NOT tg.tgisinternal AND c.relname IN ('CptLigneRemuneration','CptDecisionModeRemuneration','CptReglementPartenaire','CptAffectationReglement','CptCompensation','CptAffectationCompensation') AND p.proname NOT LIKE 'cpt\_%'
    ) THEN RAISE EXCEPTION 'un trigger Gestion Compta utilise une fonction d''un autre module'; END IF;
  END $d$;
$q$);

SELECT CASE WHEN ok THEN 'OK ' ELSE 'KO ' END || nom || coalesce('  -> ' || detail, '') AS resultat FROM resultats;

DO $$
DECLARE n_ko int; n_total int;
BEGIN
  SELECT count(*) FILTER (WHERE NOT ok), count(*) INTO n_ko, n_total FROM resultats;
  IF n_ko > 0 THEN
    RAISE EXCEPTION 'GC-9a : % contrôle(s) en échec sur %', n_ko, n_total;
  END IF;
  RAISE NOTICE 'GC-9a : % contrôles réussis', n_total;
END $$;
