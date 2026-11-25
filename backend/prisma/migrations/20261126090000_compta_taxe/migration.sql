-- Gestion Compta, lot GC-8a : taxe sur les contrats (TCA) — lignes de taxe, déclarations mensuelles, crédits, quittances.

-- CreateEnum
CREATE TYPE "CptOrigineLigneTaxe" AS ENUM ('AVANCE', 'RATTACHEMENT', 'IMPUTATION');

-- CreateEnum
CREATE TYPE "CptStatutDeclarationTca" AS ENUM ('DECLAREE', 'PAYEE');

-- CreateEnum
CREATE TYPE "CptOrigineCreditTaxe" AS ENUM ('TROP_PAYE', 'CORRECTION_TAUX');

-- CreateEnum
CREATE TYPE "CptStatutCreditTaxe" AS ENUM ('A_RECUPERER', 'RECUPERE');

-- CreateTable
CREATE TABLE "CptLigneTaxe" (
    "id" TEXT NOT NULL,
    "origine" "CptOrigineLigneTaxe" NOT NULL,
    "moisDeclaration" DATE NOT NULL,
    "encaissementId" TEXT,
    "rattachementId" TEXT,
    "echeanceId" TEXT,
    "contratId" TEXT,
    "produitCode" TEXT,
    "branche" "CptBranche",
    "base" DECIMAL(14,2) NOT NULL,
    "primeHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "accessoiresHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taux" DECIMAL(7,6) NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "ligneAvanceId" TEXT,
    "imputeeSurEcheanceId" TEXT,
    "declarationId" TEXT,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptLigneTaxe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptDeclarationTca" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "mois" DATE NOT NULL,
    "statut" "CptStatutDeclarationTca" NOT NULL DEFAULT 'DECLAREE',
    "montantDu" DECIMAL(14,2) NOT NULL,
    "montantDejaPaye" DECIMAL(14,2) NOT NULL,
    "corrections" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "montantAPayer" DECIMAL(14,2) NOT NULL,
    "nbLignes" INTEGER NOT NULL,
    "declareParId" TEXT NOT NULL,
    "declareAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quittanceNumero" TEXT,
    "quittanceDate" DATE,
    "quittanceMontant" DECIMAL(14,2),
    "datePaiement" DATE,
    "quittancePieceId" TEXT,
    "pieceOdoo" TEXT,
    "payeParId" TEXT,
    "payeAt" TIMESTAMP(3),

    CONSTRAINT "CptDeclarationTca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptCreditTaxe" (
    "id" TEXT NOT NULL,
    "origine" "CptOrigineCreditTaxe" NOT NULL,
    "declarationId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "statut" "CptStatutCreditTaxe" NOT NULL DEFAULT 'A_RECUPERER',
    "recupereDansId" TEXT,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recupereAt" TIMESTAMP(3),

    CONSTRAINT "CptCreditTaxe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CptLigneTaxe_moisDeclaration_idx" ON "CptLigneTaxe"("moisDeclaration");

-- CreateIndex
CREATE INDEX "CptLigneTaxe_declarationId_idx" ON "CptLigneTaxe"("declarationId");

-- CreateIndex
CREATE INDEX "CptLigneTaxe_encaissementId_idx" ON "CptLigneTaxe"("encaissementId");

-- CreateIndex
CREATE INDEX "CptLigneTaxe_rattachementId_idx" ON "CptLigneTaxe"("rattachementId");

-- CreateIndex
CREATE INDEX "CptLigneTaxe_ligneAvanceId_idx" ON "CptLigneTaxe"("ligneAvanceId");

-- CreateIndex
CREATE INDEX "CptLigneTaxe_contratId_idx" ON "CptLigneTaxe"("contratId");

-- CreateIndex
CREATE UNIQUE INDEX "CptDeclarationTca_reference_key" ON "CptDeclarationTca"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "CptDeclarationTca_mois_key" ON "CptDeclarationTca"("mois");

-- CreateIndex
CREATE INDEX "CptDeclarationTca_statut_idx" ON "CptDeclarationTca"("statut");

-- CreateIndex
CREATE INDEX "CptCreditTaxe_statut_idx" ON "CptCreditTaxe"("statut");

-- CreateIndex
CREATE INDEX "CptCreditTaxe_declarationId_idx" ON "CptCreditTaxe"("declarationId");

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_encaissementId_fkey" FOREIGN KEY ("encaissementId") REFERENCES "CptEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_rattachementId_fkey" FOREIGN KEY ("rattachementId") REFERENCES "CptRattachement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_echeanceId_fkey" FOREIGN KEY ("echeanceId") REFERENCES "CptEcheance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_ligneAvanceId_fkey" FOREIGN KEY ("ligneAvanceId") REFERENCES "CptLigneTaxe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_imputeeSurEcheanceId_fkey" FOREIGN KEY ("imputeeSurEcheanceId") REFERENCES "CptEcheance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "CptDeclarationTca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_declareParId_fkey" FOREIGN KEY ("declareParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_quittancePieceId_fkey" FOREIGN KEY ("quittancePieceId") REFERENCES "CptPieceJointe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_payeParId_fkey" FOREIGN KEY ("payeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptCreditTaxe" ADD CONSTRAINT "CptCreditTaxe_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "CptDeclarationTca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptCreditTaxe" ADD CONSTRAINT "CptCreditTaxe_recupereDansId_fkey" FOREIGN KEY ("recupereDansId") REFERENCES "CptDeclarationTca"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ajouts manuels ---------------------------------------------------------------------------------------------------------------------

-- Mois = premier jour du mois ; cohérence de l'origine d'une ligne ; signes.
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_mois_check" CHECK (date_trunc('month', "moisDeclaration") = "moisDeclaration");
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_taux_check" CHECK ("taux" >= 0 AND "taux" < 1);
ALTER TABLE "CptLigneTaxe" ADD CONSTRAINT "CptLigneTaxe_origine_check" CHECK (
  ("origine" = 'AVANCE' AND "encaissementId" IS NOT NULL AND "rattachementId" IS NULL AND "ligneAvanceId" IS NULL AND "base" > 0 AND "montant" >= 0)
  OR ("origine" = 'RATTACHEMENT' AND "rattachementId" IS NOT NULL AND "echeanceId" IS NOT NULL AND "ligneAvanceId" IS NULL AND "base" > 0 AND "montant" >= 0)
  OR ("origine" = 'IMPUTATION' AND "rattachementId" IS NOT NULL AND "ligneAvanceId" IS NOT NULL AND "imputeeSurEcheanceId" IS NOT NULL AND "base" < 0 AND "montant" <= 0)
);
-- Un rattachement validé n'est taxé qu'une fois, et ne consomme une avance qu'une fois.
CREATE UNIQUE INDEX "CptLigneTaxe_une_par_rattachement" ON "CptLigneTaxe" ("rattachementId") WHERE "origine" = 'RATTACHEMENT';
CREATE UNIQUE INDEX "CptLigneTaxe_une_imputation_par_rattachement" ON "CptLigneTaxe" ("rattachementId") WHERE "origine" = 'IMPUTATION';
-- Une seule avance par encaissement.
CREATE UNIQUE INDEX "CptLigneTaxe_une_avance_par_encaissement" ON "CptLigneTaxe" ("encaissementId") WHERE "origine" = 'AVANCE';

ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_mois_check" CHECK (date_trunc('month', "mois") = "mois");
ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_montants_check" CHECK ("montantAPayer" >= 0 AND "nbLignes" >= 0);
-- Payée ⇔ quittance complète.
ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_paiement_check" CHECK (
  ("statut" = 'PAYEE') = ("quittanceNumero" IS NOT NULL AND "quittanceDate" IS NOT NULL AND "quittanceMontant" IS NOT NULL
                          AND "datePaiement" IS NOT NULL AND "payeParId" IS NOT NULL AND "payeAt" IS NOT NULL)
);
ALTER TABLE "CptDeclarationTca" ADD CONSTRAINT "CptDeclarationTca_quittance_montant_check" CHECK ("quittanceMontant" IS NULL OR "quittanceMontant" >= 0);
ALTER TABLE "CptCreditTaxe" ADD CONSTRAINT "CptCreditTaxe_montant_check" CHECK ("montant" > 0);
ALTER TABLE "CptCreditTaxe" ADD CONSTRAINT "CptCreditTaxe_recupere_check" CHECK (("statut" = 'RECUPERE') = ("recupereDansId" IS NOT NULL AND "recupereAt" IS NOT NULL));

-- Une ligne de taxe est en ajout seul : seule son affectation à une déclaration (de nul à une valeur, pour un mois au plus égal à celui
-- de la déclaration) est permise ; une ligne déclarée est VERROUILLÉE.
CREATE OR REPLACE FUNCTION cpt_ligne_taxe_garde() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mois_decl date;
BEGIN
  IF OLD."declarationId" IS NOT NULL THEN
    RAISE EXCEPTION 'CPT_LIGNE_TAXE_VERROUILLEE : une ligne de taxe déclarée ne se modifie plus.';
  END IF;
  IF NEW."declarationId" IS NULL
     OR NEW."id" <> OLD."id" OR NEW."origine" <> OLD."origine" OR NEW."moisDeclaration" <> OLD."moisDeclaration"
     OR NEW."encaissementId" IS DISTINCT FROM OLD."encaissementId" OR NEW."rattachementId" IS DISTINCT FROM OLD."rattachementId"
     OR NEW."echeanceId" IS DISTINCT FROM OLD."echeanceId" OR NEW."contratId" IS DISTINCT FROM OLD."contratId"
     OR NEW."produitCode" IS DISTINCT FROM OLD."produitCode" OR NEW."branche" IS DISTINCT FROM OLD."branche"
     OR NEW."base" <> OLD."base" OR NEW."primeHt" <> OLD."primeHt" OR NEW."accessoiresHt" <> OLD."accessoiresHt"
     OR NEW."taux" <> OLD."taux" OR NEW."montant" <> OLD."montant"
     OR NEW."ligneAvanceId" IS DISTINCT FROM OLD."ligneAvanceId" OR NEW."imputeeSurEcheanceId" IS DISTINCT FROM OLD."imputeeSurEcheanceId"
     OR NEW."creeParId" <> OLD."creeParId" OR NEW."creeAt" <> OLD."creeAt" THEN
    RAISE EXCEPTION 'CPT_LIGNE_TAXE_IMMUABLE : seule l''affectation d''une ligne à une déclaration change.';
  END IF;
  SELECT "mois" INTO mois_decl FROM "CptDeclarationTca" WHERE "id" = NEW."declarationId";
  IF mois_decl IS NULL OR OLD."moisDeclaration" > mois_decl THEN
    RAISE EXCEPTION 'CPT_LIGNE_TAXE_MOIS : une ligne ne peut être déclarée avant son mois.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cpt_ligne_taxe_update" BEFORE UPDATE ON "CptLigneTaxe"
  FOR EACH ROW EXECUTE FUNCTION cpt_ligne_taxe_garde();

CREATE OR REPLACE FUNCTION cpt_ligne_taxe_delete_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."declarationId" IS NOT NULL THEN
    RAISE EXCEPTION 'CPT_LIGNE_TAXE_VERROUILLEE : une ligne de taxe déclarée ne se supprime pas.';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER "cpt_ligne_taxe_delete_a" BEFORE DELETE ON "CptLigneTaxe"
  FOR EACH ROW EXECUTE FUNCTION cpt_ligne_taxe_delete_garde();
CREATE TRIGGER "cpt_ligne_taxe_delete_b" BEFORE DELETE ON "CptLigneTaxe"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_ligne_taxe_truncate" BEFORE TRUNCATE ON "CptLigneTaxe"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- Déclaration : montants figés ; le paiement (quittance) s'ajoute UNE fois, DECLAREE → PAYEE.
CREATE OR REPLACE FUNCTION cpt_declaration_tca_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."reference" <> OLD."reference" OR NEW."mois" <> OLD."mois"
     OR NEW."montantDu" <> OLD."montantDu" OR NEW."montantDejaPaye" <> OLD."montantDejaPaye" OR NEW."corrections" <> OLD."corrections"
     OR NEW."montantAPayer" <> OLD."montantAPayer" OR NEW."nbLignes" <> OLD."nbLignes"
     OR NEW."declareParId" <> OLD."declareParId" OR NEW."declareAt" <> OLD."declareAt" THEN
    RAISE EXCEPTION 'CPT_DECLARATION_TCA_IMMUABLE : les montants d''une déclaration ne changent pas.';
  END IF;
  IF OLD."statut" = 'PAYEE' THEN
    RAISE EXCEPTION 'CPT_DECLARATION_TCA_PAYEE : une déclaration payée ne change plus.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cpt_declaration_tca_update" BEFORE UPDATE ON "CptDeclarationTca"
  FOR EACH ROW EXECUTE FUNCTION cpt_declaration_tca_garde();
CREATE TRIGGER "cpt_declaration_tca_delete" BEFORE DELETE ON "CptDeclarationTca"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_declaration_tca_truncate" BEFORE TRUNCATE ON "CptDeclarationTca"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- Crédit : seule la récupération (A_RECUPERER → RECUPERE, une fois) change.
CREATE OR REPLACE FUNCTION cpt_credit_taxe_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."origine" <> OLD."origine" OR NEW."declarationId" <> OLD."declarationId"
     OR NEW."montant" <> OLD."montant" OR NEW."creeAt" <> OLD."creeAt" THEN
    RAISE EXCEPTION 'CPT_CREDIT_TAXE_IMMUABLE : seule la récupération d''un crédit change.';
  END IF;
  IF OLD."statut" = 'RECUPERE' THEN
    RAISE EXCEPTION 'CPT_CREDIT_TAXE_RECUPERE : un crédit récupéré ne change plus.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cpt_credit_taxe_update" BEFORE UPDATE ON "CptCreditTaxe"
  FOR EACH ROW EXECUTE FUNCTION cpt_credit_taxe_garde();
CREATE TRIGGER "cpt_credit_taxe_delete" BEFORE DELETE ON "CptCreditTaxe"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_credit_taxe_truncate" BEFORE TRUNCATE ON "CptCreditTaxe"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
