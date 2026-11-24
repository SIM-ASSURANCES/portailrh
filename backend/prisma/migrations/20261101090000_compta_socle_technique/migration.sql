-- Module « Gestion Compta » — socle technique (lot GC-1a, docs/compta-conception.md §5.2 et §8).
-- Module INDÉPENDANT (décision V1) : tables, fonctions et triggers `Cpt*` / `cpt_*` entièrement nouveaux, copiés du patron
-- d'Encaissements mais sans aucune dépendance vers les objets `Enc*` / `enc_*`, qui ne sont ni lus ni modifiés ici.

-- CreateEnum
CREATE TYPE "CptStatutPeriode" AS ENUM ('OUVERTE', 'CLOTUREE');

-- CreateTable
CREATE TABLE "CptMiseEnService" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeeParId" TEXT NOT NULL,
    "sauvegardeSha256" TEXT NOT NULL,

    CONSTRAINT "CptMiseEnService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptSequence" (
    "cle" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CptSequence_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "CptParametre" (
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "majParId" TEXT,
    "majAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptParametre_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "CptAudit" (
    "id" BIGSERIAL NOT NULL,
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "avant" JSONB,
    "apres" JSONB,
    "motif" TEXT,
    "mois" DATE,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptPieceJointe" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nomOrigine" TEXT,
    "mime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "deposeeParId" TEXT NOT NULL,
    "deposeeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptPieceJointe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CptPeriode" (
    "id" TEXT NOT NULL,
    "mois" DATE NOT NULL,
    "statut" "CptStatutPeriode" NOT NULL DEFAULT 'OUVERTE',
    "clotureeParId" TEXT,
    "clotureeAt" TIMESTAMP(3),
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CptPeriode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CptAudit_entite_entiteId_idx" ON "CptAudit"("entite", "entiteId");

-- CreateIndex
CREATE INDEX "CptAudit_mois_at_idx" ON "CptAudit"("mois", "at");

-- CreateIndex
CREATE INDEX "CptAudit_at_idx" ON "CptAudit"("at");

-- CreateIndex
CREATE UNIQUE INDEX "CptPieceJointe_url_key" ON "CptPieceJointe"("url");

-- CreateIndex
CREATE INDEX "CptPieceJointe_sha256_idx" ON "CptPieceJointe"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "CptPeriode_mois_key" ON "CptPeriode"("mois");

-- CreateIndex
CREATE INDEX "CptPeriode_statut_idx" ON "CptPeriode"("statut");

-- AddForeignKey
ALTER TABLE "CptMiseEnService" ADD CONSTRAINT "CptMiseEnService_activeeParId_fkey" FOREIGN KEY ("activeeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptParametre" ADD CONSTRAINT "CptParametre_majParId_fkey" FOREIGN KEY ("majParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptAudit" ADD CONSTRAINT "CptAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptPieceJointe" ADD CONSTRAINT "CptPieceJointe_deposeeParId_fkey" FOREIGN KEY ("deposeeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CptPeriode" ADD CONSTRAINT "CptPeriode_clotureeParId_fkey" FOREIGN KEY ("clotureeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================================================
-- Ajouts manuels (docs/compta-conception.md §8) — non générés par Prisma.
-- =====================================================================================================================

-- CptMiseEnService : une seule ligne possible.
ALTER TABLE "CptMiseEnService" ADD CONSTRAINT "CptMiseEnService_ligne_unique" CHECK ("id" = 1);

-- CptPeriode : une période est toujours un mois entier (premier jour), et son état de clôture est cohérent.
ALTER TABLE "CptPeriode" ADD CONSTRAINT "CptPeriode_mois_premier_jour" CHECK (EXTRACT(DAY FROM "mois") = 1);
ALTER TABLE "CptPeriode" ADD CONSTRAINT "CptPeriode_cloture_coherente" CHECK (
  ("statut" = 'CLOTUREE' AND "clotureeParId" IS NOT NULL AND "clotureeAt" IS NOT NULL)
  OR ("statut" = 'OUVERTE' AND "clotureeAt" IS NULL)
);

-- Refus inconditionnel (UPDATE/DELETE/TRUNCATE selon le trigger qui l'appelle).
CREATE OR REPLACE FUNCTION cpt_interdire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CPT_IMMUABLE : % interdit sur la table %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- Refus seulement une fois le module mis en service (présence d'une ligne CptMiseEnService). Avant, la recette peut
-- nettoyer ; la mise en service elle-même purge AVANT d'insérer sa ligne, dans la même transaction.
CREATE OR REPLACE FUNCTION cpt_interdire_apres_mise_en_service() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CptMiseEnService") THEN
    RAISE EXCEPTION 'CPT_IMMUABLE : % interdit sur la table % après la mise en service', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_LEVEL = 'ROW' THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$$;

-- Séquences après mise en service : ni suppression, ni baisse, ni renommage.
CREATE OR REPLACE FUNCTION cpt_sequence_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CptMiseEnService") THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'CPT_IMMUABLE : suppression de la séquence % interdite après la mise en service', OLD."cle" USING ERRCODE = 'P0001';
    END IF;
    IF NEW."cle" <> OLD."cle" OR NEW."valeur" < OLD."valeur" THEN
      RAISE EXCEPTION 'CPT_IMMUABLE : baisse ou renommage de la séquence % interdit après la mise en service', OLD."cle" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Période clôturée : ni modification (donc jamais rouverte), ni suppression (RG-08).
CREATE OR REPLACE FUNCTION cpt_periode_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."statut" = 'CLOTUREE' THEN
    RAISE EXCEPTION 'CPT_IMMUABLE : % interdit sur la période % déjà clôturée', TG_OP, to_char(OLD."mois", 'YYYY-MM') USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- CptMiseEnService : jamais modifiée ni supprimée.
CREATE TRIGGER "cpt_mise_en_service_immuable" BEFORE UPDATE OR DELETE ON "CptMiseEnService"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire();
CREATE TRIGGER "cpt_mise_en_service_truncate" BEFORE TRUNCATE ON "CptMiseEnService"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire();

-- CptAudit : UPDATE toujours interdit ; DELETE et TRUNCATE interdits après la mise en service.
CREATE TRIGGER "cpt_audit_update" BEFORE UPDATE ON "CptAudit"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire();
CREATE TRIGGER "cpt_audit_delete" BEFORE DELETE ON "CptAudit"
  FOR EACH ROW EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
CREATE TRIGGER "cpt_audit_truncate" BEFORE TRUNCATE ON "CptAudit"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- CptSequence : après la mise en service, ni DELETE, ni baisse, ni TRUNCATE.
CREATE TRIGGER "cpt_sequence_garde" BEFORE UPDATE OR DELETE ON "CptSequence"
  FOR EACH ROW EXECUTE FUNCTION cpt_sequence_garde();
CREATE TRIGGER "cpt_sequence_truncate" BEFORE TRUNCATE ON "CptSequence"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();

-- CptPeriode : une période clôturée est définitive ; TRUNCATE interdit après la mise en service.
CREATE TRIGGER "cpt_periode_garde" BEFORE UPDATE OR DELETE ON "CptPeriode"
  FOR EACH ROW EXECUTE FUNCTION cpt_periode_garde();
CREATE TRIGGER "cpt_periode_truncate" BEFORE TRUNCATE ON "CptPeriode"
  FOR EACH STATEMENT EXECUTE FUNCTION cpt_interdire_apres_mise_en_service();
