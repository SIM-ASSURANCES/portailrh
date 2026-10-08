-- CreateEnum
CREATE TYPE "EncSourceEncaissement" AS ENUM ('FICHIER', 'SAISIE');

-- CreateEnum
CREATE TYPE "EncStatutEncaissement" AS ENUM ('A_CONFIRMER', 'CONFIRME', 'NON_RECU');

-- CreateEnum
CREATE TYPE "EncTypeImport" AS ENUM ('PRODUCTION', 'RELEVE', 'REPRISE');

-- CreateEnum
CREATE TYPE "EncStatutImport" AS ENUM ('APERCU', 'VALIDE', 'ABANDONNE');

-- CreateEnum
CREATE TYPE "EncAnalyseSignalement" AS ENUM ('DEJA_PRESENT', 'DOUBLON_POSSIBLE', 'A_COMPLETER', 'REFERENCE_MANQUANTE', 'REF_WAVE_NON_CONFORME', 'AJOUTE', 'SANS_PAIEMENT', 'PRIME_MODIFIEE', 'INCOHERENCE', 'ECART_TAUX', 'LIGNE_ANNULEE_REJETEE', 'ANNULATION_EN_ATTENTE_L4', 'BRANCHE_INCONNUE');

-- CreateEnum
CREATE TYPE "EncNiveauSignalement" AS ENUM ('A_TRAITER', 'INFO');

-- CreateEnum
CREATE TYPE "EncStatutSignalement" AS ENUM ('A_TRAITER', 'INFO', 'TRAITE');

-- CreateTable
CREATE TABLE "EncContrat" (
    "id" TEXT NOT NULL,
    "numPolice" TEXT NOT NULL,
    "brancheId" TEXT NOT NULL,
    "typeContrat" TEXT,
    "produitLibelle" TEXT,
    "produitCode" TEXT,
    "typeOperation" TEXT,
    "clientId" TEXT,
    "clientNom" TEXT,
    "partenaireId" TEXT,
    "dateEffet" DATE NOT NULL,
    "dateEcheance" DATE,
    "typePolice" TEXT,
    "S" DECIMAL(14,2) NOT NULL,
    "T" DECIMAL(14,2) NOT NULL,
    "U" DECIMAL(14,2) NOT NULL,
    "V" DECIMAL(14,2) NOT NULL,
    "W" DECIMAL(14,2) NOT NULL,
    "X" DECIMAL(14,2) NOT NULL,
    "partAccessoiresPartenaire" DECIMAL(7,6),
    "creeParImportId" TEXT NOT NULL,
    "majParImportId" TEXT,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncContrat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncEncaissement" (
    "id" TEXT NOT NULL,
    "paiementId" TEXT NOT NULL,
    "paiementIdFichier" TEXT,
    "contratId" TEXT NOT NULL,
    "brancheId" TEXT NOT NULL,
    "source" "EncSourceEncaissement" NOT NULL,
    "statut" "EncStatutEncaissement" NOT NULL DEFAULT 'A_CONFIRMER',
    "datePaiement" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "reference" TEXT,
    "Z" DECIMAL(14,2) NOT NULL,
    "dateSaisie" TIMESTAMP(3) NOT NULL,
    "saisiParId" TEXT NOT NULL,
    "dateConfirmation" TIMESTAMP(3),
    "confirmeParId" TEXT,
    "datePriseEnCompte" DATE,
    "ordrePriseEnCompte" INTEGER,
    "motifNonReception" TEXT,
    "nonRecuParId" TEXT,
    "nonRecuAt" TIMESTAMP(3),
    "referenceGroupe" TEXT,
    "groupeId" TEXT,
    "nonIdentifieId" TEXT,
    "importId" TEXT,
    "importLigne" INTEGER,
    "releveLigneId" TEXT,
    "contrePasseId" TEXT,
    "motifContrePassation" TEXT,
    "AA" DECIMAL(14,2),
    "AB" DECIMAL(14,2),
    "AC" DECIMAL(14,2),
    "AD" DECIMAL(14,2),
    "commission" DECIMAL(14,2),
    "honoraires" DECIMAL(14,2),
    "partAccessoiresTaux" DECIMAL(7,6),
    "partAccessoiresPartenaire" DECIMAL(14,2),
    "partAccessoiresSim" DECIMAL(14,2),
    "moisExigibilite" DATE,
    "dateLimiteReversement" DATE,
    "estRegularisation" BOOLEAN NOT NULL DEFAULT false,
    "beneficiaireHonorairesId" TEXT,
    "taxePayeeDate" TIMESTAMP(3),
    "taxePayeeReference" TEXT,
    "commissionPayeeDate" TIMESTAMP(3),
    "commissionPayeeReference" TEXT,
    "honorairesPayesDate" TIMESTAMP(3),
    "honorairesPayesReference" TEXT,
    "accessoiresPayesDate" TIMESTAMP(3),
    "accessoiresPayesReference" TEXT,
    "aRegulariser" BOOLEAN NOT NULL DEFAULT false,
    "observations" TEXT,

    CONSTRAINT "EncEncaissement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncImport" (
    "id" TEXT NOT NULL,
    "type" "EncTypeImport" NOT NULL,
    "statut" "EncStatutImport" NOT NULL,
    "nomFichier" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fichierId" TEXT,
    "brancheParDefautId" TEXT,
    "operateur" TEXT,
    "basculeTaxe" DATE,
    "basculeCommission" DATE,
    "basculeHonoraires" DATE,
    "basculeAccessoires" DATE,
    "nbLignes" INTEGER NOT NULL,
    "totalPrimesTtc" DECIMAL(14,2),
    "nbContratsCrees" INTEGER NOT NULL DEFAULT 0,
    "nbContratsMaj" INTEGER NOT NULL DEFAULT 0,
    "nbPaiementsAConfirmer" INTEGER NOT NULL DEFAULT 0,
    "nbATraiter" INTEGER NOT NULL DEFAULT 0,
    "importeParId" TEXT NOT NULL,
    "importeAt" TIMESTAMP(3) NOT NULL,
    "valideParId" TEXT,
    "valideAt" TIMESTAMP(3),

    CONSTRAINT "EncImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncSignalement" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "contratId" TEXT,
    "numPolice" TEXT,
    "brancheId" TEXT,
    "analyse" "EncAnalyseSignalement" NOT NULL,
    "niveau" "EncNiveauSignalement" NOT NULL,
    "statut" "EncStatutSignalement" NOT NULL,
    "paiementIndique" JSONB,
    "encaissementExistantId" TEXT,
    "encaissementCreeId" TEXT,
    "primeAvant" JSONB,
    "primeApres" JSONB,
    "detail" TEXT NOT NULL,
    "traiteParId" TEXT,
    "traiteAt" TIMESTAMP(3),
    "resolution" TEXT,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncSignalement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EncContrat_numPolice_key" ON "EncContrat"("numPolice");

-- CreateIndex
CREATE INDEX "EncContrat_brancheId_idx" ON "EncContrat"("brancheId");

-- CreateIndex
CREATE INDEX "EncContrat_partenaireId_idx" ON "EncContrat"("partenaireId");

-- CreateIndex
CREATE INDEX "EncContrat_clientNom_idx" ON "EncContrat"("clientNom");

-- CreateIndex
CREATE INDEX "EncContrat_produitCode_idx" ON "EncContrat"("produitCode");

-- CreateIndex
CREATE UNIQUE INDEX "EncEncaissement_paiementId_key" ON "EncEncaissement"("paiementId");

-- CreateIndex
CREATE UNIQUE INDEX "EncEncaissement_paiementIdFichier_key" ON "EncEncaissement"("paiementIdFichier");

-- CreateIndex
CREATE UNIQUE INDEX "EncEncaissement_contrePasseId_key" ON "EncEncaissement"("contrePasseId");

-- CreateIndex
CREATE INDEX "EncEncaissement_contratId_statut_ordrePriseEnCompte_idx" ON "EncEncaissement"("contratId", "statut", "ordrePriseEnCompte");

-- CreateIndex
CREATE INDEX "EncEncaissement_statut_datePaiement_idx" ON "EncEncaissement"("statut", "datePaiement");

-- CreateIndex
CREATE INDEX "EncEncaissement_reference_idx" ON "EncEncaissement"("reference");

-- CreateIndex
CREATE INDEX "EncEncaissement_moisExigibilite_idx" ON "EncEncaissement"("moisExigibilite");

-- CreateIndex
CREATE INDEX "EncEncaissement_datePriseEnCompte_idx" ON "EncEncaissement"("datePriseEnCompte");

-- CreateIndex
CREATE INDEX "EncEncaissement_importId_idx" ON "EncEncaissement"("importId");

-- CreateIndex
CREATE UNIQUE INDEX "EncImport_fichierId_key" ON "EncImport"("fichierId");

-- CreateIndex
CREATE INDEX "EncSignalement_importId_idx" ON "EncSignalement"("importId");

-- CreateIndex
CREATE INDEX "EncSignalement_contratId_idx" ON "EncSignalement"("contratId");

-- CreateIndex
CREATE INDEX "EncSignalement_statut_idx" ON "EncSignalement"("statut");

-- AddForeignKey
ALTER TABLE "EncContrat" ADD CONSTRAINT "EncContrat_brancheId_fkey" FOREIGN KEY ("brancheId") REFERENCES "EncBranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncContrat" ADD CONSTRAINT "EncContrat_partenaireId_fkey" FOREIGN KEY ("partenaireId") REFERENCES "EncPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncContrat" ADD CONSTRAINT "EncContrat_creeParImportId_fkey" FOREIGN KEY ("creeParImportId") REFERENCES "EncImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncContrat" ADD CONSTRAINT "EncContrat_majParImportId_fkey" FOREIGN KEY ("majParImportId") REFERENCES "EncImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "EncContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_brancheId_fkey" FOREIGN KEY ("brancheId") REFERENCES "EncBranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_saisiParId_fkey" FOREIGN KEY ("saisiParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_confirmeParId_fkey" FOREIGN KEY ("confirmeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_nonRecuParId_fkey" FOREIGN KEY ("nonRecuParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_importId_fkey" FOREIGN KEY ("importId") REFERENCES "EncImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncEncaissement" ADD CONSTRAINT "EncEncaissement_contrePasseId_fkey" FOREIGN KEY ("contrePasseId") REFERENCES "EncEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncImport" ADD CONSTRAINT "EncImport_fichierId_fkey" FOREIGN KEY ("fichierId") REFERENCES "EncPieceJointe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncImport" ADD CONSTRAINT "EncImport_brancheParDefautId_fkey" FOREIGN KEY ("brancheParDefautId") REFERENCES "EncBranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncImport" ADD CONSTRAINT "EncImport_importeParId_fkey" FOREIGN KEY ("importeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncImport" ADD CONSTRAINT "EncImport_valideParId_fkey" FOREIGN KEY ("valideParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncSignalement" ADD CONSTRAINT "EncSignalement_importId_fkey" FOREIGN KEY ("importId") REFERENCES "EncImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncSignalement" ADD CONSTRAINT "EncSignalement_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "EncContrat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncSignalement" ADD CONSTRAINT "EncSignalement_brancheId_fkey" FOREIGN KEY ("brancheId") REFERENCES "EncBranche"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncSignalement" ADD CONSTRAINT "EncSignalement_encaissementExistantId_fkey" FOREIGN KEY ("encaissementExistantId") REFERENCES "EncEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncSignalement" ADD CONSTRAINT "EncSignalement_encaissementCreeId_fkey" FOREIGN KEY ("encaissementCreeId") REFERENCES "EncEncaissement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncSignalement" ADD CONSTRAINT "EncSignalement_traiteParId_fkey" FOREIGN KEY ("traiteParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
