-- Gestion Compta, lot GC-5b : rattachement des encaissements aux échéances, en deux étapes (confirmation du commercial puis validation du RFCRH).
-- Docs : compta-conception.md §5.5 et §6.2.
-- CreateEnum
CREATE TYPE "CptMethodeRattachement" AS ENUM ('REFERENCE_EXACTE', 'REFERENCE_INCOMPLETE', 'MONTANT_DATE', 'GROUPE', 'PROBABLE', 'MANUELLE');

-- CreateEnum
CREATE TYPE "CptNiveauPreuve" AS ENUM ('PREUVE', 'DEDUCTION', 'A_CONFIRMER');

-- CreateEnum
CREATE TYPE "CptStatutRattachement" AS ENUM ('PROPOSE', 'CONFIRME', 'VALIDE', 'REJETE');

-- CreateTable
CREATE TABLE "CptRattachement" (
    "id" TEXT NOT NULL,
    "encaissementId" TEXT NOT NULL,
    "echeanceId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "methode" "CptMethodeRattachement" NOT NULL,
    "niveauPreuve" "CptNiveauPreuve" NOT NULL,
    "statut" "CptStatutRattachement" NOT NULL DEFAULT 'PROPOSE',
    "groupe" TEXT,
    "justification" TEXT NOT NULL,
    "proposeParId" TEXT,
    "confirmeParId" TEXT,
    "confirmeAt" TIMESTAMP(3),
    "recuReference" TEXT,
    "recuPieceId" TEXT,
    "commentaireConfirmation" TEXT,
    "valideParId" TEXT,
    "valideAt" TIMESTAMP(3),
    "rejeteParId" TEXT,
    "rejeteAt" TIMESTAMP(3),
    "motifRejet" TEXT,
    "reprise" BOOLEAN NOT NULL DEFAULT false,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptRattachement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CptRattachement_encaissementId_statut_idx" ON "CptRattachement"("encaissementId", "statut");

-- CreateIndex
CREATE INDEX "CptRattachement_echeanceId_statut_idx" ON "CptRattachement"("echeanceId", "statut");

-- CreateIndex
CREATE INDEX "CptRattachement_statut_niveauPreuve_idx" ON "CptRattachement"("statut", "niveauPreuve");

-- CreateIndex
CREATE INDEX "CptRattachement_groupe_idx" ON "CptRattachement"("groupe");

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_encaissementId_fkey" FOREIGN KEY ("encaissementId") REFERENCES "CptEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_echeanceId_fkey" FOREIGN KEY ("echeanceId") REFERENCES "CptEcheance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_proposeParId_fkey" FOREIGN KEY ("proposeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_confirmeParId_fkey" FOREIGN KEY ("confirmeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_recuPieceId_fkey" FOREIGN KEY ("recuPieceId") REFERENCES "CptPieceJointe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_rejeteParId_fkey" FOREIGN KEY ("rejeteParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================================================
-- Ajouts manuels (non modélisables par Prisma) : cohérence, séparation des tâches, plafonds et immuabilité.
-- =====================================================================================================================

-- Un montant strictement positif.
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_montant_check" CHECK ("montant" > 0);

-- Qui a fait quoi : chaque statut avancé porte son auteur et sa date, et seulement lui (RG-02 : jamais de validation anonyme).
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_valide_check"
  CHECK (("statut" = 'VALIDE') = ("valideParId" IS NOT NULL AND "valideAt" IS NOT NULL) AND ("statut" = 'VALIDE' OR ("valideParId" IS NULL AND "valideAt" IS NULL)));
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_rejete_check"
  CHECK (("statut" = 'REJETE') = ("rejeteParId" IS NOT NULL AND "rejeteAt" IS NOT NULL AND length(btrim(coalesce("motifRejet", ''))) > 0)
         AND ("statut" = 'REJETE' OR ("rejeteParId" IS NULL AND "rejeteAt" IS NULL AND "motifRejet" IS NULL)));

-- Étape 1 : une confirmation porte son auteur, sa date et le REÇU (référence et/ou pièce) ; un rattachement de niveau « preuve »
-- n'a pas d'étape 1. Un rattachement qui exige l'étape 1 ne peut être VALIDE sans elle (sauf reprise de l'ancien classeur, GC-11).
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_confirme_check"
  CHECK ("statut" <> 'CONFIRME'
         OR ("niveauPreuve" <> 'PREUVE' AND "confirmeParId" IS NOT NULL AND "confirmeAt" IS NOT NULL
             AND (length(btrim(coalesce("recuReference", ''))) > 0 OR "recuPieceId" IS NOT NULL)));
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_etape1_check"
  CHECK ("statut" <> 'VALIDE' OR "niveauPreuve" = 'PREUVE' OR "reprise"
         OR ("confirmeParId" IS NOT NULL AND (length(btrim(coalesce("recuReference", ''))) > 0 OR "recuPieceId" IS NOT NULL)));

-- Séparation des tâches : le compte qui valide n'est jamais celui qui a confirmé.
ALTER TABLE "CptRattachement" ADD CONSTRAINT "CptRattachement_separation_check"
  CHECK ("valideParId" IS NULL OR "confirmeParId" IS NULL OR "valideParId" <> "confirmeParId");

-- Une seule demande de rattachement vivante par couple (encaissement, échéance) : un rejet libère le couple.
CREATE UNIQUE INDEX "CptRattachement_actif_key" ON "CptRattachement"("encaissementId", "echeanceId") WHERE "statut" IN ('PROPOSE', 'CONFIRME', 'VALIDE');

-- À la création : seul un ENCAISSEMENT se rattache (jamais un virement interne, un frais, un test…), et jamais à une échéance annulée.
CREATE OR REPLACE FUNCTION cpt_rattachement_creation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type "CptTypeFlux";
  v_etat "CptEtatEcheance";
BEGIN
  SELECT "typeFlux" INTO v_type FROM "CptEncaissement" WHERE "id" = NEW."encaissementId";
  IF v_type IS DISTINCT FROM 'ENCAISSEMENT' THEN
    RAISE EXCEPTION 'CPT_RATTACHEMENT_TYPE : seul un encaissement peut être rattaché (encaissement %)', NEW."encaissementId" USING ERRCODE = 'P0001';
  END IF;
  SELECT "etat" INTO v_etat FROM "CptEcheance" WHERE "id" = NEW."echeanceId";
  IF v_etat IS NULL OR v_etat = 'ANNULEE' THEN
    RAISE EXCEPTION 'CPT_RATTACHEMENT_ECHEANCE : l''échéance % est annulée ou inconnue', NEW."echeanceId" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

-- Mise à jour : les champs qui décrivent la proposition ne changent jamais ; le statut n'avance que vers l'avant (PROPOSE → CONFIRME →
-- VALIDE, ou REJETE) et VALIDE / REJETE sont définitifs ; le passage à VALIDE est contrôlé SOUS VERROU (encaissement puis échéance, dans
-- cet ordre) : Σ validés + « pas une prime » ≤ montant de l'encaissement, Σ validés ≤ montant dû de l'échéance (RG-04).
CREATE OR REPLACE FUNCTION cpt_rattachement_garde() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_enc RECORD;
  v_du NUMERIC;
  v_somme NUMERIC;
BEGIN
  IF OLD."statut" IN ('VALIDE', 'REJETE') THEN
    IF to_jsonb(NEW) - 'majAt' IS DISTINCT FROM to_jsonb(OLD) - 'majAt' THEN
      RAISE EXCEPTION 'CPT_IMMUABLE : un rattachement % est définitif (rattachement %)', OLD."statut", OLD."id" USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['statut','confirmeParId','confirmeAt','recuReference','recuPieceId','commentaireConfirmation','valideParId','valideAt','rejeteParId','rejeteAt','motifRejet','majAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['statut','confirmeParId','confirmeAt','recuReference','recuPieceId','commentaireConfirmation','valideParId','valideAt','rejeteParId','rejeteAt','motifRejet','majAt']) THEN
    RAISE EXCEPTION 'CPT_IMMUABLE : les champs d''une proposition de rattachement ne changent jamais (rattachement %)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF OLD."statut" = 'CONFIRME' AND NEW."statut" = 'PROPOSE' THEN
    RAISE EXCEPTION 'CPT_TRANSITION : une confirmation ne se défait pas (rattachement %)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  IF NEW."statut" = 'VALIDE' THEN
    SELECT "montant", "montantPasUnePrime" INTO v_enc FROM "CptEncaissement" WHERE "id" = NEW."encaissementId" FOR UPDATE;
    SELECT COALESCE(SUM("montant"), 0) INTO v_somme FROM "CptRattachement"
      WHERE "encaissementId" = NEW."encaissementId" AND "statut" = 'VALIDE' AND "id" <> NEW."id";
    IF v_somme + NEW."montant" + v_enc."montantPasUnePrime" > v_enc."montant" THEN
      RAISE EXCEPTION 'CPT_SOMME_ENCAISSEMENT : le total rattaché dépasserait le montant de l''encaissement %', NEW."encaissementId" USING ERRCODE = 'P0001';
    END IF;
    SELECT "montantDu" INTO v_du FROM "CptEcheance" WHERE "id" = NEW."echeanceId" FOR UPDATE;
    SELECT COALESCE(SUM("montant"), 0) INTO v_somme FROM "CptRattachement"
      WHERE "echeanceId" = NEW."echeanceId" AND "statut" = 'VALIDE' AND "id" <> NEW."id";
    IF v_somme + NEW."montant" > v_du THEN
      RAISE EXCEPTION 'CPT_SOMME_ECHEANCE : le total rattaché dépasserait le montant dû de l''échéance %', NEW."echeanceId" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "cpt_rattachement_insert" BEFORE INSERT ON "CptRattachement"
  FOR EACH ROW EXECUTE FUNCTION cpt_rattachement_creation();
CREATE TRIGGER "cpt_rattachement_update" BEFORE UPDATE ON "CptRattachement"
  FOR EACH ROW EXECUTE FUNCTION cpt_rattachement_garde();
CREATE TRIGGER "cpt_rattachement_delete" BEFORE DELETE ON "CptRattachement"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_rattachement_truncate" BEFORE TRUNCATE ON "CptRattachement"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
