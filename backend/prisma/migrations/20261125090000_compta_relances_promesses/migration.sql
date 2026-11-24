-- Gestion Compta, lot GC-7d : relances faites hors de l'application et promesses de paiement (Q10, option A, provisoire : aucun envoi).

-- CreateEnum
CREATE TYPE "CptCanalRelance" AS ENUM ('TELEPHONE', 'SMS', 'VISITE', 'EMAIL');

-- CreateEnum
CREATE TYPE "CptOrigineRelance" AS ENUM ('MANUELLE', 'AUTOMATIQUE');

-- CreateEnum
CREATE TYPE "CptStatutPromesse" AS ENUM ('EN_COURS', 'TENUE', 'NON_TENUE');

-- CreateTable
CREATE TABLE "CptRelance" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "canal" "CptCanalRelance" NOT NULL,
    "origine" "CptOrigineRelance" NOT NULL DEFAULT 'MANUELLE',
    "faiteLe" DATE NOT NULL,
    "commentaire" TEXT,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptRelance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptPromesse" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "relanceId" TEXT,
    "montant" DECIMAL(14,2) NOT NULL,
    "datePromise" DATE NOT NULL,
    "statut" "CptStatutPromesse" NOT NULL DEFAULT 'EN_COURS',
    "evalueAt" TIMESTAMP(3),
    "montantProuve" DECIMAL(14,2),
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptPromesse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CptRelance_clientId_faiteLe_idx" ON "CptRelance"("clientId", "faiteLe");

-- CreateIndex
CREATE INDEX "CptPromesse_clientId_statut_idx" ON "CptPromesse"("clientId", "statut");

-- CreateIndex
CREATE INDEX "CptPromesse_statut_datePromise_idx" ON "CptPromesse"("statut", "datePromise");

-- AddForeignKey
ALTER TABLE "CptRelance" ADD CONSTRAINT "CptRelance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "CptClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptRelance" ADD CONSTRAINT "CptRelance_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptPromesse" ADD CONSTRAINT "CptPromesse_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "CptClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptPromesse" ADD CONSTRAINT "CptPromesse_relanceId_fkey" FOREIGN KEY ("relanceId") REFERENCES "CptRelance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptPromesse" ADD CONSTRAINT "CptPromesse_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ajouts manuels ---------------------------------------------------------------------------------------------------------------------

-- Un montant promis strictement positif ; l'évaluation va toujours avec un statut final (et l'inverse).
ALTER TABLE "CptPromesse" ADD CONSTRAINT "CptPromesse_montant_check" CHECK ("montant" > 0);
ALTER TABLE "CptPromesse" ADD CONSTRAINT "CptPromesse_evaluation_check"
  CHECK (("statut" = 'EN_COURS') = ("evalueAt" IS NULL AND "montantProuve" IS NULL));

-- Une relance est en ajout seul : jamais modifiée.
CREATE OR REPLACE FUNCTION cpt_relance_immuable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CPT_RELANCE_IMMUABLE : une relance enregistrée ne se modifie pas.';
END;
$$;
CREATE TRIGGER "cpt_relance_update" BEFORE UPDATE ON "CptRelance"
  FOR EACH ROW EXECUTE FUNCTION cpt_relance_immuable();
CREATE TRIGGER "cpt_relance_delete" BEFORE DELETE ON "CptRelance"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_relance_truncate" BEFORE TRUNCATE ON "CptRelance"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- Une promesse : seuls statut, évaluation et montant prouvé changent, UNE fois, depuis EN_COURS.
CREATE OR REPLACE FUNCTION cpt_promesse_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."clientId" <> OLD."clientId" OR NEW."relanceId" IS DISTINCT FROM OLD."relanceId"
     OR NEW."montant" <> OLD."montant" OR NEW."datePromise" <> OLD."datePromise" OR NEW."creeParId" <> OLD."creeParId" OR NEW."creeAt" <> OLD."creeAt" THEN
    RAISE EXCEPTION 'CPT_PROMESSE_IMMUABLE : seuls le statut et son évaluation d''une promesse changent.';
  END IF;
  IF OLD."statut" <> 'EN_COURS' THEN
    RAISE EXCEPTION 'CPT_PROMESSE_FINALE : une promesse tenue ou non tenue ne change plus.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "cpt_promesse_update" BEFORE UPDATE ON "CptPromesse"
  FOR EACH ROW EXECUTE FUNCTION cpt_promesse_garde();
CREATE TRIGGER "cpt_promesse_delete" BEFORE DELETE ON "CptPromesse"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_promesse_truncate" BEFORE TRUNCATE ON "CptPromesse"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
