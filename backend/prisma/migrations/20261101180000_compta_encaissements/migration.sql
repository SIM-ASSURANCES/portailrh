-- Gestion Compta, lot GC-4a : encaissements et relevés (encaissement, relevé, virement interne, chèque). Docs : compta-conception.md §5.5.
-- CreateEnum
CREATE TYPE "CptTypeFlux" AS ENUM ('ENCAISSEMENT', 'VIREMENT_INTERNE_ENTRANT', 'VIREMENT_INTERNE_SORTANT', 'REMBOURSEMENT', 'TEST', 'FRAIS', 'AUTRE_DEBIT');

-- CreateEnum
CREATE TYPE "CptStatutEncaissement" AS ENUM ('A_RATTACHER', 'SOLDE', 'SANS_OBJET');

-- CreateEnum
CREATE TYPE "CptStatutCheque" AS ENUM ('RECU', 'REMIS_EN_BANQUE', 'IMPAYE');

-- CreateTable
CREATE TABLE "CptEncaissement" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "referenceReleve" TEXT NOT NULL,
    "dateValeur" DATE NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "frais" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "typeFlux" "CptTypeFlux" NOT NULL,
    "typeSource" TEXT,
    "payeur" TEXT,
    "telephone" TEXT,
    "referenceClient" TEXT,
    "libelle" TEXT,
    "sessionPaiement" TEXT,
    "statut" "CptStatutEncaissement" NOT NULL DEFAULT 'A_RATTACHER',
    "resteARattacher" DECIMAL(14,2) NOT NULL,
    "montantPasUnePrime" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "motifPasUnePrime" TEXT,
    "releveId" TEXT,
    "ligneReleve" INTEGER,
    "pieceOdoo" TEXT,
    "dateComptabilisation" DATE,
    "reprise" BOOLEAN NOT NULL DEFAULT false,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptEncaissement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptReleve" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "compteId" TEXT NOT NULL,
    "periode" DATE NOT NULL,
    "nbLignes" INTEGER NOT NULL,
    "totalCredits" DECIMAL(14,2) NOT NULL,
    "totalFrais" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptReleve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptTransfertInterne" (
    "id" TEXT NOT NULL,
    "encaissementSortantId" TEXT NOT NULL,
    "encaissementEntrantId" TEXT NOT NULL,
    "compteSourceId" TEXT NOT NULL,
    "compteCibleId" TEXT NOT NULL,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptTransfertInterne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptCheque" (
    "id" TEXT NOT NULL,
    "encaissementId" TEXT,
    "dateReception" DATE NOT NULL,
    "numero" TEXT NOT NULL,
    "tireur" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "dateRemiseBanque" DATE,
    "statut" "CptStatutCheque" NOT NULL DEFAULT 'RECU',
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptCheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CptEncaissement_reference_key" ON "CptEncaissement"("reference");

-- CreateIndex
CREATE INDEX "CptEncaissement_statut_dateValeur_idx" ON "CptEncaissement"("statut", "dateValeur");

-- CreateIndex
CREATE INDEX "CptEncaissement_compteId_dateValeur_idx" ON "CptEncaissement"("compteId", "dateValeur");

-- CreateIndex
CREATE INDEX "CptEncaissement_releveId_idx" ON "CptEncaissement"("releveId");

-- CreateIndex
CREATE INDEX "CptEncaissement_referenceClient_idx" ON "CptEncaissement"("referenceClient");

-- CreateIndex
CREATE INDEX "CptEncaissement_telephone_idx" ON "CptEncaissement"("telephone");

-- CreateIndex
CREATE UNIQUE INDEX "CptEncaissement_compteId_referenceReleve_key" ON "CptEncaissement"("compteId", "referenceReleve");

-- CreateIndex
CREATE UNIQUE INDEX "CptReleve_importId_key" ON "CptReleve"("importId");

-- CreateIndex
CREATE INDEX "CptReleve_compteId_periode_idx" ON "CptReleve"("compteId", "periode");

-- CreateIndex
CREATE UNIQUE INDEX "CptTransfertInterne_encaissementSortantId_key" ON "CptTransfertInterne"("encaissementSortantId");

-- CreateIndex
CREATE UNIQUE INDEX "CptTransfertInterne_encaissementEntrantId_key" ON "CptTransfertInterne"("encaissementEntrantId");

-- CreateIndex
CREATE UNIQUE INDEX "CptCheque_encaissementId_key" ON "CptCheque"("encaissementId");

-- CreateIndex
CREATE INDEX "CptCheque_statut_idx" ON "CptCheque"("statut");

-- CreateIndex
CREATE INDEX "CptCheque_numero_idx" ON "CptCheque"("numero");

-- AddForeignKey
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "CptCompte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_releveId_fkey" FOREIGN KEY ("releveId") REFERENCES "CptReleve"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptReleve" ADD CONSTRAINT "CptReleve_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CptImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptReleve" ADD CONSTRAINT "CptReleve_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "CptCompte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_encaissementSortantId_fkey" FOREIGN KEY ("encaissementSortantId") REFERENCES "CptEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_encaissementEntrantId_fkey" FOREIGN KEY ("encaissementEntrantId") REFERENCES "CptEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_compteSourceId_fkey" FOREIGN KEY ("compteSourceId") REFERENCES "CptCompte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_compteCibleId_fkey" FOREIGN KEY ("compteCibleId") REFERENCES "CptCompte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptCheque" ADD CONSTRAINT "CptCheque_encaissementId_fkey" FOREIGN KEY ("encaissementId") REFERENCES "CptEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptCheque" ADD CONSTRAINT "CptCheque_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================================================
-- Ajouts manuels (non modélisables par Prisma) : contraintes de cohérence et immuabilité.
-- =====================================================================================================================

-- Encaissement : des montants jamais négatifs ; le reste à rattacher et la part « pas une prime » tiennent dans le montant.
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_montants_check"
  CHECK ("montant" >= 0 AND "frais" >= 0 AND "resteARattacher" >= 0 AND "montantPasUnePrime" >= 0
         AND "resteARattacher" + "montantPasUnePrime" <= "montant");

-- Seule une ligne de type ENCAISSEMENT attend un rattachement ; toute autre ligne est « sans objet » (et inversement).
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_statut_type_check"
  CHECK (("typeFlux" = 'ENCAISSEMENT') = ("statut" <> 'SANS_OBJET'));

-- Soldé : plus rien à rattacher. Sans objet : ni reste ni part « pas une prime ».
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_solde_check"
  CHECK ("statut" <> 'SOLDE' OR "resteARattacher" = 0);
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_sans_objet_check"
  CHECK ("statut" <> 'SANS_OBJET' OR ("resteARattacher" = 0 AND "montantPasUnePrime" = 0));

-- RG-03 : une part classée « pas une prime » a toujours un motif écrit.
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_motif_check"
  CHECK ("montantPasUnePrime" = 0 OR length(btrim(coalesce("motifPasUnePrime", ''))) > 0);

-- Une ligne de relevé : le relevé et le rang vont ensemble (un chèque ou un reçu de caisse n'a ni l'un ni l'autre).
ALTER TABLE "CptEncaissement" ADD CONSTRAINT "CptEncaissement_ligne_check"
  CHECK (("releveId" IS NULL) = ("ligneReleve" IS NULL) AND ("ligneReleve" IS NULL OR "ligneReleve" >= 1));

-- Relevé : le premier jour d'un mois, des totaux cohérents.
ALTER TABLE "CptReleve" ADD CONSTRAINT "CptReleve_periode_check" CHECK ("periode" = date_trunc('month', "periode")::date);
ALTER TABLE "CptReleve" ADD CONSTRAINT "CptReleve_totaux_check" CHECK ("nbLignes" >= 0 AND "totalCredits" >= 0 AND "totalFrais" >= 0);

-- Virement interne : deux lignes différentes, deux comptes différents.
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_lignes_check" CHECK ("encaissementSortantId" <> "encaissementEntrantId");
ALTER TABLE "CptTransfertInterne" ADD CONSTRAINT "CptTransfertInterne_comptes_check" CHECK ("compteSourceId" <> "compteCibleId");

-- Chèque : un montant strictement positif ; reçu = pas encore remis (ni date de remise ni encaissement), remis ou impayé =
-- date de remise renseignée et jamais avant la réception.
ALTER TABLE "CptCheque" ADD CONSTRAINT "CptCheque_montant_check" CHECK ("montant" > 0);
ALTER TABLE "CptCheque" ADD CONSTRAINT "CptCheque_remise_check"
  CHECK (("statut" = 'RECU') = ("dateRemiseBanque" IS NULL) AND ("dateRemiseBanque" IS NULL OR "dateRemiseBanque" >= "dateReception"));
ALTER TABLE "CptCheque" ADD CONSTRAINT "CptCheque_encaissement_check" CHECK ("statut" <> 'RECU' OR "encaissementId" IS NULL);

-- Encaissement : les champs qui décrivent la ligne ne changent jamais ; seuls le rattachement, le classement « pas une prime »,
-- le statut et les champs comptables Odoo évoluent. Une seule exception pour le type de flux : un virement entre deux comptes
-- du groupe n'est reconnu que lorsque l'AUTRE côté arrive (le relevé de la banque après celui de Wave) ; la ligne déjà importée
-- passe alors de ENCAISSEMENT / AUTRE_DEBIT à VIREMENT_INTERNE_* (et inversement si le rapprochement est défait). Tout autre
-- changement de type est refusé. Suppression et TRUNCATE interdits dès la mise en service.
CREATE OR REPLACE FUNCTION cpt_encaissement_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['typeFlux','statut','resteARattacher','montantPasUnePrime','motifPasUnePrime','pieceOdoo','dateComptabilisation','majAt'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['typeFlux','statut','resteARattacher','montantPasUnePrime','motifPasUnePrime','pieceOdoo','dateComptabilisation','majAt']) THEN
    RAISE EXCEPTION 'CPT_IMMUABLE : les champs d''une ligne d''encaissement ne changent jamais (encaissement %)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  -- Quatre passages seulement, le sens est conservé : crédit (ENCAISSEMENT) ↔ VIREMENT_INTERNE_ENTRANT, débit (AUTRE_DEBIT) ↔
  -- VIREMENT_INTERNE_SORTANT. Un virement ne devient jamais une transaction test, un remboursement ou des frais.
  IF NEW."typeFlux" IS DISTINCT FROM OLD."typeFlux"
     AND NOT (
       (OLD."typeFlux" = 'ENCAISSEMENT' AND NEW."typeFlux" = 'VIREMENT_INTERNE_ENTRANT')
       OR (OLD."typeFlux" = 'VIREMENT_INTERNE_ENTRANT' AND NEW."typeFlux" = 'ENCAISSEMENT')
       OR (OLD."typeFlux" = 'AUTRE_DEBIT' AND NEW."typeFlux" = 'VIREMENT_INTERNE_SORTANT')
       OR (OLD."typeFlux" = 'VIREMENT_INTERNE_SORTANT' AND NEW."typeFlux" = 'AUTRE_DEBIT')
     ) THEN
    RAISE EXCEPTION 'CPT_IMMUABLE : le type de flux ne change que pour reconnaître ou défaire un virement interne, dans le même sens (encaissement %)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cpt_encaissement_update" BEFORE UPDATE ON "CptEncaissement"
  FOR EACH ROW EXECUTE FUNCTION cpt_encaissement_garde();
CREATE TRIGGER "cpt_encaissement_delete" BEFORE DELETE ON "CptEncaissement"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_encaissement_truncate" BEFORE TRUNCATE ON "CptEncaissement"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- Relevé et virement interne : jamais modifiés ; suppression et TRUNCATE interdits dès la mise en service.
CREATE TRIGGER "cpt_releve_update" BEFORE UPDATE ON "CptReleve"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire();
CREATE TRIGGER "cpt_releve_delete" BEFORE DELETE ON "CptReleve"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_releve_truncate" BEFORE TRUNCATE ON "CptReleve"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_transfert_update" BEFORE UPDATE ON "CptTransfertInterne"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire();
CREATE TRIGGER "cpt_transfert_delete" BEFORE DELETE ON "CptTransfertInterne"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_transfert_truncate" BEFORE TRUNCATE ON "CptTransfertInterne"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- Chèque : son statut avance (reçu, remis, impayé) ; il ne se supprime plus après la mise en service.
CREATE TRIGGER "cpt_cheque_delete" BEFORE DELETE ON "CptCheque"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_cheque_truncate" BEFORE TRUNCATE ON "CptCheque"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
