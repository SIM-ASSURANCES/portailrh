-- Gestion Compta, lot GC-9a : rémunération des partenaires — lignes de rémunération, décisions de mode de règlement, règlements
-- et affectations, compensations. Rejouable sans effet (IF NOT EXISTS, gardes sur les contraintes, triggers recréés).
-- Les bordereaux des partenaires (GC-9d) ne sont pas créés ici : en attente des modèles de fichiers.

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CptModePaiementPartenaire') THEN
    CREATE TYPE "CptModePaiementPartenaire" AS ENUM ('VIREMENT', 'CHEQUE', 'ESPECES', 'MOBILE_MONEY', 'AUTRE');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CptLigneRemuneration" (
    "id" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "echeanceId" TEXT NOT NULL,
    "partenaireBeneficiaireId" TEXT NOT NULL,
    "nature" "CptNatureRemuneration" NOT NULL,
    "conventionId" TEXT NOT NULL,
    "du" DECIMAL(14,2) NOT NULL,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptLigneRemuneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CptDecisionModeRemuneration" (
    "id" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "partenaireId" TEXT NOT NULL,
    "nature" "CptNatureRemuneration" NOT NULL,
    "mode" "CptModeReglement" NOT NULL,
    "motif" TEXT NOT NULL,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptDecisionModeRemuneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CptReglementPartenaire" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partenaireId" TEXT NOT NULL,
    "nature" "CptNatureRemuneration" NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "mode" "CptModePaiementPartenaire" NOT NULL,
    "referenceReglement" TEXT NOT NULL,
    "pieceOdoo" TEXT,
    "dateComptabilisation" DATE,
    "modeDerogation" "CptModeReglement",
    "montantAvance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motif" TEXT,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptReglementPartenaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CptAffectationReglement" (
    "id" TEXT NOT NULL,
    "reglementId" TEXT NOT NULL,
    "ligneRemunerationId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CptAffectationReglement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CptCompensation" (
    "id" TEXT NOT NULL,
    "partenaireId" TEXT NOT NULL,
    "natureSource" "CptNatureRemuneration" NOT NULL,
    "natureCible" "CptNatureRemuneration" NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "motif" TEXT NOT NULL,
    "valideeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CptAffectationCompensation" (
    "id" TEXT NOT NULL,
    "compensationId" TEXT NOT NULL,
    "ligneRemunerationId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CptAffectationCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptLigneRemuneration_partenaireBeneficiaireId_nature_idx" ON "CptLigneRemuneration"("partenaireBeneficiaireId", "nature");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptLigneRemuneration_echeanceId_idx" ON "CptLigneRemuneration"("echeanceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptLigneRemuneration_conventionId_idx" ON "CptLigneRemuneration"("conventionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CptLigneRemuneration_contratId_echeanceId_partenaireBenefic_key" ON "CptLigneRemuneration"("contratId", "echeanceId", "partenaireBeneficiaireId", "nature");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptDecisionModeRemuneration_partenaireId_nature_idx" ON "CptDecisionModeRemuneration"("partenaireId", "nature");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptDecisionModeRemuneration_contratId_idx" ON "CptDecisionModeRemuneration"("contratId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CptReglementPartenaire_reference_key" ON "CptReglementPartenaire"("reference");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptReglementPartenaire_partenaireId_nature_idx" ON "CptReglementPartenaire"("partenaireId", "nature");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptReglementPartenaire_date_idx" ON "CptReglementPartenaire"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptAffectationReglement_ligneRemunerationId_idx" ON "CptAffectationReglement"("ligneRemunerationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CptAffectationReglement_reglementId_ligneRemunerationId_key" ON "CptAffectationReglement"("reglementId", "ligneRemunerationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptCompensation_partenaireId_idx" ON "CptCompensation"("partenaireId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CptAffectationCompensation_ligneRemunerationId_idx" ON "CptAffectationCompensation"("ligneRemunerationId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CptAffectationCompensation_compensationId_ligneRemuneration_key" ON "CptAffectationCompensation"("compensationId", "ligneRemunerationId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptLigneRemuneration_contratId_fkey') THEN
    ALTER TABLE "CptLigneRemuneration" ADD CONSTRAINT "CptLigneRemuneration_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "CptContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptLigneRemuneration_echeanceId_fkey') THEN
    ALTER TABLE "CptLigneRemuneration" ADD CONSTRAINT "CptLigneRemuneration_echeanceId_fkey" FOREIGN KEY ("echeanceId") REFERENCES "CptEcheance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptLigneRemuneration_partenaireBeneficiaireId_fkey') THEN
    ALTER TABLE "CptLigneRemuneration" ADD CONSTRAINT "CptLigneRemuneration_partenaireBeneficiaireId_fkey" FOREIGN KEY ("partenaireBeneficiaireId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptLigneRemuneration_conventionId_fkey') THEN
    ALTER TABLE "CptLigneRemuneration" ADD CONSTRAINT "CptLigneRemuneration_conventionId_fkey" FOREIGN KEY ("conventionId") REFERENCES "CptConvention"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptLigneRemuneration_creeParId_fkey') THEN
    ALTER TABLE "CptLigneRemuneration" ADD CONSTRAINT "CptLigneRemuneration_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptDecisionModeRemuneration_contratId_fkey') THEN
    ALTER TABLE "CptDecisionModeRemuneration" ADD CONSTRAINT "CptDecisionModeRemuneration_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "CptContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptDecisionModeRemuneration_partenaireId_fkey') THEN
    ALTER TABLE "CptDecisionModeRemuneration" ADD CONSTRAINT "CptDecisionModeRemuneration_partenaireId_fkey" FOREIGN KEY ("partenaireId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptDecisionModeRemuneration_creeParId_fkey') THEN
    ALTER TABLE "CptDecisionModeRemuneration" ADD CONSTRAINT "CptDecisionModeRemuneration_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptReglementPartenaire_partenaireId_fkey') THEN
    ALTER TABLE "CptReglementPartenaire" ADD CONSTRAINT "CptReglementPartenaire_partenaireId_fkey" FOREIGN KEY ("partenaireId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptReglementPartenaire_creeParId_fkey') THEN
    ALTER TABLE "CptReglementPartenaire" ADD CONSTRAINT "CptReglementPartenaire_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAffectationReglement_reglementId_fkey') THEN
    ALTER TABLE "CptAffectationReglement" ADD CONSTRAINT "CptAffectationReglement_reglementId_fkey" FOREIGN KEY ("reglementId") REFERENCES "CptReglementPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAffectationReglement_ligneRemunerationId_fkey') THEN
    ALTER TABLE "CptAffectationReglement" ADD CONSTRAINT "CptAffectationReglement_ligneRemunerationId_fkey" FOREIGN KEY ("ligneRemunerationId") REFERENCES "CptLigneRemuneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptCompensation_partenaireId_fkey') THEN
    ALTER TABLE "CptCompensation" ADD CONSTRAINT "CptCompensation_partenaireId_fkey" FOREIGN KEY ("partenaireId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptCompensation_valideeParId_fkey') THEN
    ALTER TABLE "CptCompensation" ADD CONSTRAINT "CptCompensation_valideeParId_fkey" FOREIGN KEY ("valideeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAffectationCompensation_compensationId_fkey') THEN
    ALTER TABLE "CptAffectationCompensation" ADD CONSTRAINT "CptAffectationCompensation_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "CptCompensation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAffectationCompensation_ligneRemunerationId_fkey') THEN
    ALTER TABLE "CptAffectationCompensation" ADD CONSTRAINT "CptAffectationCompensation_ligneRemunerationId_fkey" FOREIGN KEY ("ligneRemunerationId") REFERENCES "CptLigneRemuneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Ajouts manuels ---------------------------------------------------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptLigneRemuneration_du_check') THEN
    ALTER TABLE "CptLigneRemuneration" ADD CONSTRAINT "CptLigneRemuneration_du_check" CHECK ("du" >= 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptDecisionModeRemuneration_motif_check') THEN
    ALTER TABLE "CptDecisionModeRemuneration" ADD CONSTRAINT "CptDecisionModeRemuneration_motif_check" CHECK (char_length(btrim("motif")) >= 10);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptReglementPartenaire_montant_check') THEN
    ALTER TABLE "CptReglementPartenaire" ADD CONSTRAINT "CptReglementPartenaire_montant_check" CHECK ("montant" > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptReglementPartenaire_avance_check') THEN
    ALTER TABLE "CptReglementPartenaire" ADD CONSTRAINT "CptReglementPartenaire_avance_check" CHECK ("montantAvance" >= 0 AND "montantAvance" <= "montant");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptReglementPartenaire_motif_check') THEN
    ALTER TABLE "CptReglementPartenaire" ADD CONSTRAINT "CptReglementPartenaire_motif_check" CHECK (("montantAvance" = 0 AND "modeDerogation" IS NULL) OR ("motif" IS NOT NULL AND char_length(btrim("motif")) >= 10));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptReglementPartenaire_reference_reglement_check') THEN
    ALTER TABLE "CptReglementPartenaire" ADD CONSTRAINT "CptReglementPartenaire_reference_reglement_check" CHECK (char_length(btrim("referenceReglement")) >= 1);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAffectationReglement_montant_check') THEN
    ALTER TABLE "CptAffectationReglement" ADD CONSTRAINT "CptAffectationReglement_montant_check" CHECK ("montant" > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptCompensation_montant_check') THEN
    ALTER TABLE "CptCompensation" ADD CONSTRAINT "CptCompensation_montant_check" CHECK ("montant" > 0);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptCompensation_natures_check') THEN
    ALTER TABLE "CptCompensation" ADD CONSTRAINT "CptCompensation_natures_check" CHECK ("natureSource" <> "natureCible");
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptCompensation_motif_check') THEN
    ALTER TABLE "CptCompensation" ADD CONSTRAINT "CptCompensation_motif_check" CHECK (char_length(btrim("motif")) >= 10);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptAffectationCompensation_montant_check') THEN
    ALTER TABLE "CptAffectationCompensation" ADD CONSTRAINT "CptAffectationCompensation_montant_check" CHECK ("montant" <> 0);
  END IF;
END $$;

-- Aucune écriture ne se modifie : une correction est une nouvelle écriture. Seule exception : la pièce Odoo d'un règlement et sa
-- date, vides à la saisie, peuvent être renseignées une fois (le montant, la nature et les affectations ne bougent jamais).
CREATE OR REPLACE FUNCTION cpt_remuneration_immuable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CPT_REMUNERATION_IMMUABLE : % ne se modifie pas (une correction est une nouvelle écriture).', TG_TABLE_NAME;
END;
$$;

CREATE OR REPLACE FUNCTION cpt_reglement_partenaire_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."reference" <> OLD."reference" OR NEW."partenaireId" <> OLD."partenaireId" OR NEW."nature" <> OLD."nature"
     OR NEW."montant" <> OLD."montant" OR NEW."date" <> OLD."date" OR NEW."mode" <> OLD."mode"
     OR NEW."referenceReglement" <> OLD."referenceReglement" OR NEW."modeDerogation" IS DISTINCT FROM OLD."modeDerogation"
     OR NEW."montantAvance" <> OLD."montantAvance" OR NEW."motif" IS DISTINCT FROM OLD."motif"
     OR NEW."creeParId" <> OLD."creeParId" OR NEW."creeAt" <> OLD."creeAt"
     OR (OLD."pieceOdoo" IS NOT NULL AND NEW."pieceOdoo" IS DISTINCT FROM OLD."pieceOdoo")
     OR (OLD."dateComptabilisation" IS NOT NULL AND NEW."dateComptabilisation" IS DISTINCT FROM OLD."dateComptabilisation") THEN
    RAISE EXCEPTION 'CPT_REMUNERATION_IMMUABLE : un règlement ne se modifie pas (seule la pièce Odoo, d''abord vide, se renseigne une fois).';
  END IF;
  RETURN NEW;
END;
$$;

-- Une ligne appartient au contrat de son échéance.
CREATE OR REPLACE FUNCTION cpt_ligne_remuneration_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CptEcheance" e WHERE e."id" = NEW."echeanceId" AND e."contratId" = NEW."contratId") THEN
    RAISE EXCEPTION 'CPT_LIGNE_REMUNERATION_CONTRAT : l''échéance n''appartient pas au contrat de la ligne.';
  END IF;
  RETURN NEW;
END;
$$;

-- Une affectation vise une ligne du MÊME partenaire et de la MÊME nature que son règlement. La ligne est verrouillée : deux
-- affectations simultanées d'une même ligne sont contrôlées l'une après l'autre.
CREATE OR REPLACE FUNCTION cpt_affectation_reglement_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record; r record;
BEGIN
  SELECT "partenaireBeneficiaireId", "nature" INTO l FROM "CptLigneRemuneration" WHERE "id" = NEW."ligneRemunerationId" FOR UPDATE;
  SELECT "partenaireId", "nature" INTO r FROM "CptReglementPartenaire" WHERE "id" = NEW."reglementId";
  IF l."partenaireBeneficiaireId" IS DISTINCT FROM r."partenaireId" OR l."nature" IS DISTINCT FROM r."nature" THEN
    RAISE EXCEPTION 'CPT_AFFECTATION_NATURE : une affectation vise une ligne du même partenaire et de la même nature que le règlement.';
  END IF;
  RETURN NEW;
END;
$$;

-- Compensation : montant négatif sur une ligne de la nature source, positif sur une ligne de la nature cible, du même partenaire.
CREATE OR REPLACE FUNCTION cpt_affectation_compensation_coherence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l record; c record;
BEGIN
  SELECT "partenaireBeneficiaireId", "nature" INTO l FROM "CptLigneRemuneration" WHERE "id" = NEW."ligneRemunerationId" FOR UPDATE;
  SELECT "partenaireId", "natureSource", "natureCible" INTO c FROM "CptCompensation" WHERE "id" = NEW."compensationId";
  IF l."partenaireBeneficiaireId" IS DISTINCT FROM c."partenaireId"
     OR l."nature" IS DISTINCT FROM (CASE WHEN NEW."montant" < 0 THEN c."natureSource" ELSE c."natureCible" END) THEN
    RAISE EXCEPTION 'CPT_COMPENSATION_NATURE : montant négatif sur la nature source, positif sur la nature cible, même partenaire.';
  END IF;
  RETURN NEW;
END;
$$;

-- Payé d'une ligne = affectations de règlements + de compensations : jamais négatif, jamais au-delà du montant dû de la ligne.
CREATE OR REPLACE FUNCTION cpt_verifier_ligne_remuneration(p_ligne text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_du numeric; v_paye numeric;
BEGIN
  SELECT "du" INTO v_du FROM "CptLigneRemuneration" WHERE "id" = p_ligne;
  IF v_du IS NULL THEN RETURN; END IF;
  SELECT coalesce((SELECT sum("montant") FROM "CptAffectationReglement" WHERE "ligneRemunerationId" = p_ligne), 0)
       + coalesce((SELECT sum("montant") FROM "CptAffectationCompensation" WHERE "ligneRemunerationId" = p_ligne), 0)
    INTO v_paye;
  IF v_paye < 0 OR v_paye > v_du THEN
    RAISE EXCEPTION 'CPT_LIGNE_REMUNERATION_PAYE : le payé d''une ligne (%) doit rester entre 0 et son montant dû (%).', v_paye, v_du;
  END IF;
END;
$$;

-- Contrôles DIFFÉRÉS (à la validation de la transaction) : Σ des affectations d'un règlement = son montant ; pour une
-- compensation, Σ des positifs = Σ des négatifs = son montant.
CREATE OR REPLACE FUNCTION cpt_verifier_somme_reglement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id text; v_montant numeric; v_somme numeric;
BEGIN
  IF TG_TABLE_NAME = 'CptReglementPartenaire' THEN v_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN v_id := OLD."reglementId"; PERFORM cpt_verifier_ligne_remuneration(OLD."ligneRemunerationId");
  ELSE v_id := NEW."reglementId"; PERFORM cpt_verifier_ligne_remuneration(NEW."ligneRemunerationId");
  END IF;
  SELECT "montant" INTO v_montant FROM "CptReglementPartenaire" WHERE "id" = v_id;
  IF v_montant IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum("montant"), 0) INTO v_somme FROM "CptAffectationReglement" WHERE "reglementId" = v_id;
  IF v_somme <> v_montant THEN
    RAISE EXCEPTION 'CPT_REGLEMENT_AFFECTATIONS : la somme des affectations (%) diffère du montant du règlement (%).', v_somme, v_montant;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION cpt_verifier_somme_compensation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id text; v_montant numeric; v_plus numeric; v_moins numeric;
BEGIN
  IF TG_TABLE_NAME = 'CptCompensation' THEN v_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN v_id := OLD."compensationId"; PERFORM cpt_verifier_ligne_remuneration(OLD."ligneRemunerationId");
  ELSE v_id := NEW."compensationId"; PERFORM cpt_verifier_ligne_remuneration(NEW."ligneRemunerationId");
  END IF;
  SELECT "montant" INTO v_montant FROM "CptCompensation" WHERE "id" = v_id;
  IF v_montant IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(sum("montant") FILTER (WHERE "montant" > 0), 0), coalesce(-sum("montant") FILTER (WHERE "montant" < 0), 0)
    INTO v_plus, v_moins FROM "CptAffectationCompensation" WHERE "compensationId" = v_id;
  IF v_plus <> v_montant OR v_moins <> v_montant THEN
    RAISE EXCEPTION 'CPT_COMPENSATION_AFFECTATIONS : ajouts (%) et reprises (%) doivent valoir le montant (%).', v_plus, v_moins, v_montant;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS "cpt_ligne_remuneration_insert" ON "CptLigneRemuneration";
CREATE TRIGGER "cpt_ligne_remuneration_insert" BEFORE INSERT ON "CptLigneRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_ligne_remuneration_coherence();
DROP TRIGGER IF EXISTS "cpt_affectation_reglement_insert" ON "CptAffectationReglement";
CREATE TRIGGER "cpt_affectation_reglement_insert" BEFORE INSERT ON "CptAffectationReglement"
  FOR EACH ROW EXECUTE FUNCTION cpt_affectation_reglement_coherence();
DROP TRIGGER IF EXISTS "cpt_affectation_compensation_insert" ON "CptAffectationCompensation";
CREATE TRIGGER "cpt_affectation_compensation_insert" BEFORE INSERT ON "CptAffectationCompensation"
  FOR EACH ROW EXECUTE FUNCTION cpt_affectation_compensation_coherence();
DROP TRIGGER IF EXISTS "cpt_reglement_partenaire_update" ON "CptReglementPartenaire";
CREATE TRIGGER "cpt_reglement_partenaire_update" BEFORE UPDATE ON "CptReglementPartenaire"
  FOR EACH ROW EXECUTE FUNCTION cpt_reglement_partenaire_garde();
DROP TRIGGER IF EXISTS "cpt_ligne_remuneration_update" ON "CptLigneRemuneration";
CREATE TRIGGER "cpt_ligne_remuneration_update" BEFORE UPDATE ON "CptLigneRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_remuneration_immuable();
DROP TRIGGER IF EXISTS "cpt_decision_mode_remuneration_update" ON "CptDecisionModeRemuneration";
CREATE TRIGGER "cpt_decision_mode_remuneration_update" BEFORE UPDATE ON "CptDecisionModeRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_remuneration_immuable();
DROP TRIGGER IF EXISTS "cpt_affectation_reglement_update" ON "CptAffectationReglement";
CREATE TRIGGER "cpt_affectation_reglement_update" BEFORE UPDATE ON "CptAffectationReglement"
  FOR EACH ROW EXECUTE FUNCTION cpt_remuneration_immuable();
DROP TRIGGER IF EXISTS "cpt_compensation_update" ON "CptCompensation";
CREATE TRIGGER "cpt_compensation_update" BEFORE UPDATE ON "CptCompensation"
  FOR EACH ROW EXECUTE FUNCTION cpt_remuneration_immuable();
DROP TRIGGER IF EXISTS "cpt_affectation_compensation_update" ON "CptAffectationCompensation";
CREATE TRIGGER "cpt_affectation_compensation_update" BEFORE UPDATE ON "CptAffectationCompensation"
  FOR EACH ROW EXECUTE FUNCTION cpt_remuneration_immuable();
DROP TRIGGER IF EXISTS "cpt_ligne_remuneration_delete" ON "CptLigneRemuneration";
CREATE TRIGGER "cpt_ligne_remuneration_delete" BEFORE DELETE ON "CptLigneRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_ligne_remuneration_truncate" ON "CptLigneRemuneration";
CREATE TRIGGER "cpt_ligne_remuneration_truncate" BEFORE TRUNCATE ON "CptLigneRemuneration"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_decision_mode_remuneration_delete" ON "CptDecisionModeRemuneration";
CREATE TRIGGER "cpt_decision_mode_remuneration_delete" BEFORE DELETE ON "CptDecisionModeRemuneration"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_decision_mode_remuneration_truncate" ON "CptDecisionModeRemuneration";
CREATE TRIGGER "cpt_decision_mode_remuneration_truncate" BEFORE TRUNCATE ON "CptDecisionModeRemuneration"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_reglement_partenaire_delete" ON "CptReglementPartenaire";
CREATE TRIGGER "cpt_reglement_partenaire_delete" BEFORE DELETE ON "CptReglementPartenaire"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_reglement_partenaire_truncate" ON "CptReglementPartenaire";
CREATE TRIGGER "cpt_reglement_partenaire_truncate" BEFORE TRUNCATE ON "CptReglementPartenaire"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_affectation_reglement_delete" ON "CptAffectationReglement";
CREATE TRIGGER "cpt_affectation_reglement_delete" BEFORE DELETE ON "CptAffectationReglement"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_affectation_reglement_truncate" ON "CptAffectationReglement";
CREATE TRIGGER "cpt_affectation_reglement_truncate" BEFORE TRUNCATE ON "CptAffectationReglement"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_compensation_delete" ON "CptCompensation";
CREATE TRIGGER "cpt_compensation_delete" BEFORE DELETE ON "CptCompensation"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_compensation_truncate" ON "CptCompensation";
CREATE TRIGGER "cpt_compensation_truncate" BEFORE TRUNCATE ON "CptCompensation"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_affectation_compensation_delete" ON "CptAffectationCompensation";
CREATE TRIGGER "cpt_affectation_compensation_delete" BEFORE DELETE ON "CptAffectationCompensation"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_affectation_compensation_truncate" ON "CptAffectationCompensation";
CREATE TRIGGER "cpt_affectation_compensation_truncate" BEFORE TRUNCATE ON "CptAffectationCompensation"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
DROP TRIGGER IF EXISTS "cpt_reglement_partenaire_somme" ON "CptReglementPartenaire";
CREATE CONSTRAINT TRIGGER "cpt_reglement_partenaire_somme" AFTER INSERT ON "CptReglementPartenaire"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cpt_verifier_somme_reglement();
DROP TRIGGER IF EXISTS "cpt_affectation_reglement_somme" ON "CptAffectationReglement";
CREATE CONSTRAINT TRIGGER "cpt_affectation_reglement_somme" AFTER INSERT OR DELETE ON "CptAffectationReglement"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cpt_verifier_somme_reglement();
DROP TRIGGER IF EXISTS "cpt_compensation_somme" ON "CptCompensation";
CREATE CONSTRAINT TRIGGER "cpt_compensation_somme" AFTER INSERT ON "CptCompensation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cpt_verifier_somme_compensation();
DROP TRIGGER IF EXISTS "cpt_affectation_compensation_somme" ON "CptAffectationCompensation";
CREATE CONSTRAINT TRIGGER "cpt_affectation_compensation_somme" AFTER INSERT OR DELETE ON "CptAffectationCompensation"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cpt_verifier_somme_compensation();
