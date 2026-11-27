-- Gestion Compta : annulation tracée d'un règlement de partenaire ou d'une compensation (Q22, décision du 2026-11-27, registre
-- C-38). Ajout seul ; une seule annulation par opération. Une table commune aux deux types : mêmes champs, mêmes gardes, une seule
-- relation vers l'auteur ; les clés étrangères restent réelles (une colonne par type, exactement une renseignée).
-- Rejouable sans effet (IF NOT EXISTS, gardes sur les contraintes, fonctions remplacées, triggers recréés). Les tables et triggers
-- de la migration 20261128090000 ne sont pas affaiblis : un règlement et une compensation restent immuables.

CREATE TABLE IF NOT EXISTS "CptAnnulationRemuneration" (
    "id" TEXT NOT NULL,
    "reglementId" TEXT,
    "compensationId" TEXT,
    "date" DATE NOT NULL,
    "motif" TEXT NOT NULL,
    "sansVersement" BOOLEAN NOT NULL DEFAULT false,
    "pieceOdoo" TEXT,
    "dateComptabilisation" DATE,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptAnnulationRemuneration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CptAnnulationRemuneration_reglementId_key" ON "CptAnnulationRemuneration"("reglementId");
CREATE UNIQUE INDEX IF NOT EXISTS "CptAnnulationRemuneration_compensationId_key" ON "CptAnnulationRemuneration"("compensationId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAnnulationRemuneration_reglementId_fkey') THEN
    ALTER TABLE "CptAnnulationRemuneration" ADD CONSTRAINT "CptAnnulationRemuneration_reglementId_fkey" FOREIGN KEY ("reglementId") REFERENCES "CptReglementPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAnnulationRemuneration_compensationId_fkey') THEN
    ALTER TABLE "CptAnnulationRemuneration" ADD CONSTRAINT "CptAnnulationRemuneration_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "CptCompensation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAnnulationRemuneration_creeParId_fkey') THEN
    ALTER TABLE "CptAnnulationRemuneration" ADD CONSTRAINT "CptAnnulationRemuneration_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAnnulationRemuneration_une_operation_check') THEN
    ALTER TABLE "CptAnnulationRemuneration" ADD CONSTRAINT "CptAnnulationRemuneration_une_operation_check" CHECK (num_nonnulls("reglementId", "compensationId") = 1);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAnnulationRemuneration_motif_check') THEN
    ALTER TABLE "CptAnnulationRemuneration" ADD CONSTRAINT "CptAnnulationRemuneration_motif_check" CHECK (char_length(btrim("motif")) >= 10);
  END IF;
END $$;
-- Un règlement ne s'annule que si aucun versement n'a eu lieu (ou s'il a été rejeté par la banque).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAnnulationRemuneration_versement_check') THEN
    ALTER TABLE "CptAnnulationRemuneration" ADD CONSTRAINT "CptAnnulationRemuneration_versement_check" CHECK ("reglementId" IS NULL OR "sansVersement");
  END IF;
END $$;

-- L'auteur d'une opération ne l'annule jamais. Les lignes touchées sont verrouillées, comme à l'insertion d'une affectation.
CREATE OR REPLACE FUNCTION cpt_annulation_remuneration_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_auteur text;
BEGIN
  IF NEW."reglementId" IS NOT NULL THEN
    SELECT "creeParId" INTO v_auteur FROM "CptReglementPartenaire" WHERE "id" = NEW."reglementId";
  ELSE
    SELECT "valideeParId" INTO v_auteur FROM "CptCompensation" WHERE "id" = NEW."compensationId";
  END IF;
  IF v_auteur = NEW."creeParId" THEN
    RAISE EXCEPTION 'CPT_ANNULATION_AUTEUR : l''auteur d''une opération ne peut pas l''annuler.';
  END IF;
  PERFORM 1 FROM "CptLigneRemuneration" l WHERE l."id" IN (
    SELECT "ligneRemunerationId" FROM "CptAffectationReglement" WHERE "reglementId" = NEW."reglementId"
    UNION
    SELECT "ligneRemunerationId" FROM "CptAffectationCompensation" WHERE "compensationId" = NEW."compensationId"
  ) ORDER BY l."id" FOR UPDATE;
  RETURN NEW;
END;
$$;

-- Payé d'une ligne = affectations des opérations NON ANNULÉES : sinon un règlement correct ressaisi serait refusé.
CREATE OR REPLACE FUNCTION cpt_verifier_ligne_remuneration(p_ligne text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_du numeric; v_paye numeric;
BEGIN
  SELECT "du" INTO v_du FROM "CptLigneRemuneration" WHERE "id" = p_ligne;
  IF v_du IS NULL THEN RETURN; END IF;
  SELECT coalesce((SELECT sum(a."montant") FROM "CptAffectationReglement" a
                    WHERE a."ligneRemunerationId" = p_ligne
                      AND NOT EXISTS (SELECT 1 FROM "CptAnnulationRemuneration" x WHERE x."reglementId" = a."reglementId")), 0)
       + coalesce((SELECT sum(a."montant") FROM "CptAffectationCompensation" a
                    WHERE a."ligneRemunerationId" = p_ligne
                      AND NOT EXISTS (SELECT 1 FROM "CptAnnulationRemuneration" x WHERE x."compensationId" = a."compensationId")), 0)
    INTO v_paye;
  IF v_paye < 0 OR v_paye > v_du THEN
    RAISE EXCEPTION 'CPT_LIGNE_REMUNERATION_PAYE : le payé d''une ligne (%) doit rester entre 0 et son montant dû (%).', v_paye, v_du;
  END IF;
END;
$$;

-- Contrôle DIFFÉRÉ après une annulation : aucune ligne de l'opération annulée ne devient négative ni payée au-delà de son dû.
CREATE OR REPLACE FUNCTION cpt_verifier_annulation_remuneration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_ligne text;
BEGIN
  FOR v_ligne IN
    SELECT "ligneRemunerationId" FROM "CptAffectationReglement" WHERE "reglementId" = NEW."reglementId"
    UNION
    SELECT "ligneRemunerationId" FROM "CptAffectationCompensation" WHERE "compensationId" = NEW."compensationId"
  LOOP
    PERFORM cpt_verifier_ligne_remuneration(v_ligne);
  END LOOP;
  RETURN NULL;
END;
$$;

-- Une annulation ne se modifie pas (seule la pièce Odoo de contre-passation, d'abord vide, se renseigne une fois) et ne se
-- supprime jamais ligne par ligne : la supprimer ferait revivre l'opération.
CREATE OR REPLACE FUNCTION cpt_annulation_remuneration_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CPT_REMUNERATION_IMMUABLE : une annulation ne se supprime pas.';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."reglementId" IS DISTINCT FROM OLD."reglementId" OR NEW."compensationId" IS DISTINCT FROM OLD."compensationId"
     OR NEW."date" <> OLD."date" OR NEW."motif" <> OLD."motif" OR NEW."sansVersement" <> OLD."sansVersement"
     OR NEW."creeParId" <> OLD."creeParId" OR NEW."creeAt" <> OLD."creeAt"
     OR (OLD."pieceOdoo" IS NOT NULL AND NEW."pieceOdoo" IS DISTINCT FROM OLD."pieceOdoo")
     OR (OLD."dateComptabilisation" IS NOT NULL AND NEW."dateComptabilisation" IS DISTINCT FROM OLD."dateComptabilisation") THEN
    RAISE EXCEPTION 'CPT_REMUNERATION_IMMUABLE : une annulation ne se modifie pas (seule la pièce Odoo, d''abord vide, se renseigne une fois).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "cpt_annulation_remuneration_avant_insert" ON "CptAnnulationRemuneration";
CREATE TRIGGER "cpt_annulation_remuneration_avant_insert" BEFORE INSERT ON "CptAnnulationRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_annulation_remuneration_insert();
DROP TRIGGER IF EXISTS "cpt_annulation_remuneration_garde" ON "CptAnnulationRemuneration";
CREATE TRIGGER "cpt_annulation_remuneration_garde" BEFORE UPDATE OR DELETE ON "CptAnnulationRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_annulation_remuneration_garde();
-- TRUNCATE : comme le reste du module, seulement avant la mise en service (remise à zéro).
DROP TRIGGER IF EXISTS "cpt_annulation_remuneration_truncate" ON "CptAnnulationRemuneration";
CREATE TRIGGER "cpt_annulation_remuneration_truncate" BEFORE TRUNCATE ON "CptAnnulationRemuneration"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_annulation_remuneration_lignes" ON "CptAnnulationRemuneration";
CREATE CONSTRAINT TRIGGER "cpt_annulation_remuneration_lignes" AFTER INSERT ON "CptAnnulationRemuneration"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cpt_verifier_annulation_remuneration();
