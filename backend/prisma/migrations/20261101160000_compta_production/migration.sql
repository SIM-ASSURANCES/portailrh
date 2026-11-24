-- Gestion Compta, lot GC-3a : production (contrats, actes, échéances, imports, anomalies). Docs : compta-conception.md §5.4.
-- CreateEnum
CREATE TYPE "CptStatutContrat" AS ENUM ('EN_COURS', 'ECHU', 'ANNULE', 'RESILIE');

-- CreateEnum
CREATE TYPE "CptTypeActe" AS ENUM ('AFFAIRE_NOUVELLE', 'RENOUVELLEMENT', 'TRANCHE', 'AVENANT_INCORPORATION', 'RETRAIT', 'RISTOURNE', 'ANNULATION');

-- CreateEnum
CREATE TYPE "CptFractionnement" AS ENUM ('COMPTANT', 'MENSUEL', 'TRIMESTRIEL', 'SEMESTRIEL', 'LIBRE');

-- CreateEnum
CREATE TYPE "CptEtatEcheance" AS ENUM ('OUVERTE', 'SOLDEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "CptStatutImport" AS ENUM ('VALIDE', 'ANNULE');

-- CreateEnum
CREATE TYPE "CptStatutAnomalie" AS ENUM ('A_TRAITER', 'TRAITEE');

-- CreateTable
CREATE TABLE "CptContrat" (
    "id" TEXT NOT NULL,
    "numPolice" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "natureContrat" "CptNatureContrat" NOT NULL,
    "clientId" TEXT NOT NULL,
    "partenaireApporteurId" TEXT,
    "dateEffet" DATE NOT NULL,
    "dateEcheance" DATE NOT NULL,
    "statut" "CptStatutContrat" NOT NULL DEFAULT 'EN_COURS',
    "fractionnement" "CptFractionnement" NOT NULL DEFAULT 'COMPTANT',
    "tauxTcaContrat" DECIMAL(7,6),
    "primeNetteHt" DECIMAL(14,2) NOT NULL,
    "accessoiresHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "primeTtc" DECIMAL(14,2) NOT NULL,
    "declarePaye" BOOLEAN NOT NULL DEFAULT false,
    "modePaiementDeclare" TEXT,
    "referencePaiementDeclaree" TEXT,
    "datePaiementDeclaree" DATE,
    "contratOrigineId" TEXT,
    "importId" TEXT,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptContrat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptActe" (
    "id" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "type" "CptTypeActe" NOT NULL,
    "date" DATE NOT NULL,
    "primeNetteHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "accessoiresHt" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "primeTtc" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "acteOrigineId" TEXT,
    "motif" TEXT,
    "importId" TEXT,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptActe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptEcheance" (
    "id" TEXT NOT NULL,
    "contratId" TEXT NOT NULL,
    "rang" INTEGER NOT NULL,
    "periodeDebut" DATE NOT NULL,
    "periodeFin" DATE NOT NULL,
    "datePrevue" DATE NOT NULL,
    "primeTtc" DECIMAL(14,2) NOT NULL,
    "primeHt" DECIMAL(14,2) NOT NULL,
    "accessoires" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "montantDu" DECIMAL(14,2) NOT NULL,
    "montantRegle" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "etat" "CptEtatEcheance" NOT NULL DEFAULT 'OUVERTE',
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptEcheance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptImport" (
    "id" TEXT NOT NULL,
    "type" "CptTypeImport" NOT NULL,
    "formatId" TEXT,
    "fichierId" TEXT NOT NULL,
    "empreinte" TEXT NOT NULL,
    "compteId" TEXT,
    "periode" DATE,
    "statut" "CptStatutImport" NOT NULL DEFAULT 'VALIDE',
    "bilan" JSONB,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptAnomalie" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objetEntite" TEXT NOT NULL,
    "objetId" TEXT NOT NULL,
    "detail" JSONB,
    "statut" "CptStatutAnomalie" NOT NULL DEFAULT 'A_TRAITER',
    "importId" TEXT,
    "traiteeParId" TEXT,
    "traiteeAt" TIMESTAMP(3),
    "resolution" TEXT,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptAnomalie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CptContrat_numPolice_key" ON "CptContrat"("numPolice");

-- CreateIndex
CREATE INDEX "CptContrat_clientId_idx" ON "CptContrat"("clientId");

-- CreateIndex
CREATE INDEX "CptContrat_partenaireApporteurId_idx" ON "CptContrat"("partenaireApporteurId");

-- CreateIndex
CREATE INDEX "CptContrat_produitId_idx" ON "CptContrat"("produitId");

-- CreateIndex
CREATE INDEX "CptContrat_statut_idx" ON "CptContrat"("statut");

-- CreateIndex
CREATE INDEX "CptContrat_referencePaiementDeclaree_idx" ON "CptContrat"("referencePaiementDeclaree");

-- CreateIndex
CREATE INDEX "CptContrat_importId_idx" ON "CptContrat"("importId");

-- CreateIndex
CREATE INDEX "CptActe_contratId_date_idx" ON "CptActe"("contratId", "date");

-- CreateIndex
CREATE INDEX "CptActe_importId_idx" ON "CptActe"("importId");

-- CreateIndex
CREATE INDEX "CptEcheance_contratId_etat_idx" ON "CptEcheance"("contratId", "etat");

-- CreateIndex
CREATE INDEX "CptEcheance_etat_datePrevue_idx" ON "CptEcheance"("etat", "datePrevue");

-- CreateIndex
CREATE UNIQUE INDEX "CptEcheance_contratId_rang_key" ON "CptEcheance"("contratId", "rang");

-- CreateIndex
CREATE UNIQUE INDEX "CptImport_fichierId_key" ON "CptImport"("fichierId");

-- CreateIndex
CREATE UNIQUE INDEX "CptImport_empreinte_key" ON "CptImport"("empreinte");

-- CreateIndex
CREATE INDEX "CptImport_type_creeAt_idx" ON "CptImport"("type", "creeAt");

-- CreateIndex
CREATE INDEX "CptAnomalie_statut_creeAt_idx" ON "CptAnomalie"("statut", "creeAt");

-- CreateIndex
CREATE INDEX "CptAnomalie_objetEntite_objetId_idx" ON "CptAnomalie"("objetEntite", "objetId");

-- CreateIndex
CREATE INDEX "CptAnomalie_importId_idx" ON "CptAnomalie"("importId");

-- AddForeignKey
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "CptProduit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "CptClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_partenaireApporteurId_fkey" FOREIGN KEY ("partenaireApporteurId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_contratOrigineId_fkey" FOREIGN KEY ("contratOrigineId") REFERENCES "CptContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CptImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptActe" ADD CONSTRAINT "CptActe_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "CptContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptActe" ADD CONSTRAINT "CptActe_acteOrigineId_fkey" FOREIGN KEY ("acteOrigineId") REFERENCES "CptActe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptActe" ADD CONSTRAINT "CptActe_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CptImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptActe" ADD CONSTRAINT "CptActe_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptEcheance" ADD CONSTRAINT "CptEcheance_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "CptContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptImport" ADD CONSTRAINT "CptImport_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "CptFormatImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptImport" ADD CONSTRAINT "CptImport_fichierId_fkey" FOREIGN KEY ("fichierId") REFERENCES "CptPieceJointe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptImport" ADD CONSTRAINT "CptImport_compteId_fkey" FOREIGN KEY ("compteId") REFERENCES "CptCompte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptImport" ADD CONSTRAINT "CptImport_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptAnomalie" ADD CONSTRAINT "CptAnomalie_importId_fkey" FOREIGN KEY ("importId") REFERENCES "CptImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptAnomalie" ADD CONSTRAINT "CptAnomalie_traiteeParId_fkey" FOREIGN KEY ("traiteeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =====================================================================================================================
-- Ajouts manuels (non modélisables par Prisma) : contraintes de cohérence et immuabilité.
-- =====================================================================================================================

-- Contrat : des montants jamais négatifs (un contrat est le contrat initial ; les évolutions sont des actes signés), une
-- période cohérente, un taux de TCA en fraction. La cohérence TTC = HT + accessoires + taxe n'est PAS une contrainte : un
-- écart est une anomalie signalée à l'import (lecture permissive).
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_montants_check"
  CHECK ("primeNetteHt" >= 0 AND "accessoiresHt" >= 0 AND "taxe" >= 0 AND "primeTtc" >= 0);
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_periode_check" CHECK ("dateEcheance" >= "dateEffet");
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_taux_check" CHECK ("tauxTcaContrat" IS NULL OR ("tauxTcaContrat" >= 0 AND "tauxTcaContrat" <= 1));
ALTER TABLE "CptContrat" ADD CONSTRAINT "CptContrat_origine_check" CHECK ("contratOrigineId" IS NULL OR "contratOrigineId" <> "id");

-- Acte : pas d'auto-référence.
ALTER TABLE "CptActe" ADD CONSTRAINT "CptActe_origine_check" CHECK ("acteOrigineId" IS NULL OR "acteOrigineId" <> "id");

-- Échéance : rang à partir de 1, période cohérente, montants jamais négatifs. `montantRegle` peut dépasser `montantDu` : un
-- avenant à la baisse laisse un trop-perçu à traiter, jamais une écriture refusée.
ALTER TABLE "CptEcheance" ADD CONSTRAINT "CptEcheance_rang_check" CHECK ("rang" >= 1);
ALTER TABLE "CptEcheance" ADD CONSTRAINT "CptEcheance_periode_check" CHECK ("periodeFin" >= "periodeDebut");
ALTER TABLE "CptEcheance" ADD CONSTRAINT "CptEcheance_montants_check"
  CHECK ("primeTtc" >= 0 AND "primeHt" >= 0 AND "accessoires" >= 0 AND "taxe" >= 0 AND "montantDu" >= 0 AND "montantRegle" >= 0);

-- Import : le premier jour du mois pour une période de relevé.
ALTER TABLE "CptImport" ADD CONSTRAINT "CptImport_periode_check" CHECK ("periode" IS NULL OR "periode" = date_trunc('month', "periode")::date);

-- Anomalie traitée : qui l'a traitée et quand.
ALTER TABLE "CptAnomalie" ADD CONSTRAINT "CptAnomalie_traitee_check"
  CHECK ("statut" <> 'TRAITEE' OR ("traiteeParId" IS NOT NULL AND "traiteeAt" IS NOT NULL));

-- Un acte n'est jamais modifié (une erreur se corrige par un acte inverse) ; suppression et TRUNCATE interdits dès la
-- mise en service. Les autres tables de production ne se suppriment plus après la mise en service.
CREATE TRIGGER "cpt_acte_update" BEFORE UPDATE ON "CptActe"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire();
CREATE TRIGGER "cpt_acte_delete" BEFORE DELETE ON "CptActe"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_acte_truncate" BEFORE TRUNCATE ON "CptActe"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

CREATE TRIGGER "cpt_contrat_delete" BEFORE DELETE ON "CptContrat"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_contrat_truncate" BEFORE TRUNCATE ON "CptContrat"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_echeance_delete" BEFORE DELETE ON "CptEcheance"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_echeance_truncate" BEFORE TRUNCATE ON "CptEcheance"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_import_delete" BEFORE DELETE ON "CptImport"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_import_truncate" BEFORE TRUNCATE ON "CptImport"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_anomalie_delete" BEFORE DELETE ON "CptAnomalie"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_anomalie_truncate" BEFORE TRUNCATE ON "CptAnomalie"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
