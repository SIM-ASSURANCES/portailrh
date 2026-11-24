-- Gestion Compta, lot GC-2a — référentiels (docs/compta-conception.md §5.3) : partenaires, clients, produits, taux de TCA datés,
-- comptes d'encaissement, conventions de rémunération. Partie générée par Prisma, puis ajouts manuels (bornes, unicité
-- NULLS NOT DISTINCT, triggers d'immuabilité). Indépendant des autres modules : aucune table existante n'est touchée.

-- CreateEnum
CREATE TYPE "CptBranche" AS ENUM ('ACCIDENTS', 'SANTE', 'INCENDIE', 'DECES');

-- CreateEnum
CREATE TYPE "CptNatureContrat" AS ENUM ('INDIVIDUEL', 'GROUPE');

-- CreateEnum
CREATE TYPE "CptTypeCompte" AS ENUM ('WAVE_BUSINESS', 'WAVE_HORS_BUSINESS', 'BANQUE', 'MICROFINANCE', 'AGREGATEUR', 'CAISSE');

-- CreateEnum
CREATE TYPE "CptNatureRemuneration" AS ENUM ('COMMISSION', 'ACCESSOIRES', 'HONORAIRES');

-- CreateEnum
CREATE TYPE "CptBaseConvention" AS ENUM ('PRIME_NETTE', 'NETTE_PLUS_ACCESSOIRES', 'TTC');

-- CreateEnum
CREATE TYPE "CptFaitGenerateur" AS ENUM ('EMISSION', 'ENCAISSEMENT');

-- CreateEnum
CREATE TYPE "CptModeReglement" AS ENUM ('EN_UNE_FOIS', 'AU_PRORATA');

-- CreateTable
CREATE TABLE "CptPartenaire" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "estApporteur" BOOLEAN NOT NULL DEFAULT false,
    "estBeneficiaire" BOOLEAN NOT NULL DEFAULT false,
    "estGestionnaire" BOOLEAN NOT NULL DEFAULT false,
    "estClient" BOOLEAN NOT NULL DEFAULT false,
    "coordonnees" TEXT,
    "tiersOdoo" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptPartenaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptClient" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "pieceIdentite" TEXT,
    "partenaireOrigineId" TEXT,
    "tiersOdoo" TEXT,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptProduit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "branche" "CptBranche" NOT NULL,
    "tarifReference" DECIMAL(14,2),
    "compteOdoo" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptProduit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptTauxTca" (
    "id" TEXT NOT NULL,
    "branche" "CptBranche" NOT NULL,
    "produitCode" TEXT,
    "natureContrat" "CptNatureContrat",
    "taux" DECIMAL(7,6) NOT NULL,
    "dateEffet" DATE NOT NULL,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptTauxTca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptCompte" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" "CptTypeCompte" NOT NULL,
    "journalOdoo" TEXT,
    "compteOdoo" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CptCompte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptConvention" (
    "id" TEXT NOT NULL,
    "partenaireId" TEXT NOT NULL,
    "produitCode" TEXT,
    "nature" "CptNatureRemuneration" NOT NULL,
    "taux" DECIMAL(7,6) NOT NULL,
    "base" "CptBaseConvention" NOT NULL,
    "faitGenerateur" "CptFaitGenerateur" NOT NULL,
    "apporteurId" TEXT,
    "beneficiaireId" TEXT,
    "modeReglement" "CptModeReglement" NOT NULL,
    "dateEffet" DATE NOT NULL,
    "dateFin" DATE,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptConvention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CptPartenaire_nom_key" ON "CptPartenaire"("nom");

-- CreateIndex
CREATE INDEX "CptClient_nom_idx" ON "CptClient"("nom");

-- CreateIndex
CREATE INDEX "CptClient_telephone_idx" ON "CptClient"("telephone");

-- CreateIndex
CREATE INDEX "CptClient_partenaireOrigineId_idx" ON "CptClient"("partenaireOrigineId");

-- CreateIndex
CREATE UNIQUE INDEX "CptProduit_code_key" ON "CptProduit"("code");

-- CreateIndex
CREATE INDEX "CptTauxTca_dateEffet_idx" ON "CptTauxTca"("dateEffet");

-- CreateIndex
CREATE INDEX "CptTauxTca_branche_dateEffet_idx" ON "CptTauxTca"("branche", "dateEffet");

-- CreateIndex
CREATE INDEX "CptCompte_type_idx" ON "CptCompte"("type");

-- CreateIndex
CREATE INDEX "CptConvention_partenaireId_nature_dateEffet_idx" ON "CptConvention"("partenaireId", "nature", "dateEffet");

-- AddForeignKey
ALTER TABLE "CptClient" ADD CONSTRAINT "CptClient_partenaireOrigineId_fkey" FOREIGN KEY ("partenaireOrigineId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTauxTca" ADD CONSTRAINT "CptTauxTca_produitCode_fkey" FOREIGN KEY ("produitCode") REFERENCES "CptProduit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptTauxTca" ADD CONSTRAINT "CptTauxTca_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_partenaireId_fkey" FOREIGN KEY ("partenaireId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_produitCode_fkey" FOREIGN KEY ("produitCode") REFERENCES "CptProduit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_apporteurId_fkey" FOREIGN KEY ("apporteurId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_beneficiaireId_fkey" FOREIGN KEY ("beneficiaireId") REFERENCES "CptPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================================================
-- Ajouts manuels (non modélisables par Prisma)
-- =====================================================================================================================

-- Bornes : un taux est une fraction entre 0 et 1 ; une convention ne se termine pas avant de commencer.
ALTER TABLE "CptTauxTca" ADD CONSTRAINT "CptTauxTca_taux_check" CHECK ("taux" >= 0 AND "taux" <= 1);
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_taux_check" CHECK ("taux" >= 0 AND "taux" <= 1);
ALTER TABLE "CptConvention" ADD CONSTRAINT "CptConvention_periode_check" CHECK ("dateFin" IS NULL OR "dateFin" >= "dateEffet");

-- Taux de TCA : unicité (branche, produit, nature, date d'effet) en traitant NULL comme une valeur (PostgreSQL 15 et plus ;
-- sans cela, deux lignes « branche seule » à la même date ne se heurteraient jamais).
CREATE UNIQUE INDEX "CptTauxTca_unique_portee_date" ON "CptTauxTca" ("branche", "produitCode", "natureContrat", "dateEffet") NULLS NOT DISTINCT;

-- CptTauxTca : une ligne n'est jamais modifiée (un nouveau taux est une nouvelle ligne datée) ; suppression et TRUNCATE
-- interdits dès la mise en service du module (avant, une saisie de test peut être retirée).
CREATE TRIGGER "cpt_taux_tca_update" BEFORE UPDATE ON "CptTauxTca"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire();
CREATE TRIGGER "cpt_taux_tca_delete" BEFORE DELETE ON "CptTauxTca"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_taux_tca_truncate" BEFORE TRUNCATE ON "CptTauxTca"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- CptConvention : seule la date de fin peut changer (clôture de la convention) ; tout le reste se corrige par une nouvelle
-- convention. Suppression et TRUNCATE interdits dès la mise en service.
CREATE OR REPLACE FUNCTION cpt_convention_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'dateFin') IS DISTINCT FROM (to_jsonb(OLD) - 'dateFin') THEN
    RAISE EXCEPTION 'CPT_IMMUABLE : seule la date de fin d''une convention peut être modifiée (convention %)', OLD."id" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cpt_convention_update" BEFORE UPDATE ON "CptConvention"
  FOR EACH ROW EXECUTE FUNCTION cpt_convention_garde();
CREATE TRIGGER "cpt_convention_delete" BEFORE DELETE ON "CptConvention"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_convention_truncate" BEFORE TRUNCATE ON "CptConvention"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
