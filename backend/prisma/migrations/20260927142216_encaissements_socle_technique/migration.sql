-- CreateTable
CREATE TABLE "EncMiseEnService" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeeParId" TEXT NOT NULL,
    "sauvegardeSha256" TEXT NOT NULL,

    CONSTRAINT "EncMiseEnService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncSequence" (
    "cle" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EncSequence_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "EncParametre" (
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "majParId" TEXT,
    "majAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncParametre_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "EncAudit" (
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

    CONSTRAINT "EncAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncPieceJointe" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "nomOrigine" TEXT,
    "mime" TEXT NOT NULL,
    "taille" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "deposeeParId" TEXT NOT NULL,
    "deposeeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncPieceJointe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EncAudit_entite_entiteId_idx" ON "EncAudit"("entite", "entiteId");

-- CreateIndex
CREATE INDEX "EncAudit_mois_at_idx" ON "EncAudit"("mois", "at");

-- CreateIndex
CREATE INDEX "EncAudit_at_idx" ON "EncAudit"("at");

-- CreateIndex
CREATE UNIQUE INDEX "EncPieceJointe_url_key" ON "EncPieceJointe"("url");

-- CreateIndex
CREATE INDEX "EncPieceJointe_sha256_idx" ON "EncPieceJointe"("sha256");

-- AddForeignKey
ALTER TABLE "EncMiseEnService" ADD CONSTRAINT "EncMiseEnService_activeeParId_fkey" FOREIGN KEY ("activeeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncParametre" ADD CONSTRAINT "EncParametre_majParId_fkey" FOREIGN KEY ("majParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncAudit" ADD CONSTRAINT "EncAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncPieceJointe" ADD CONSTRAINT "EncPieceJointe_deposeeParId_fkey" FOREIGN KEY ("deposeeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================================================
-- Ajouts manuels (docs/encaissements-conception.md §6) — non générés par Prisma.
-- =====================================================================================================================

-- EncMiseEnService : une seule ligne possible.
ALTER TABLE "EncMiseEnService" ADD CONSTRAINT "EncMiseEnService_ligne_unique" CHECK ("id" = 1);

-- Refus inconditionnel (UPDATE/DELETE/TRUNCATE selon le trigger qui l'appelle).
CREATE OR REPLACE FUNCTION enc_interdire() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ENC_IMMUABLE : % interdit sur la table %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

-- Refus seulement une fois le module mis en service (présence d'une ligne EncMiseEnService). Avant, la recette peut
-- nettoyer ; la mise en service elle-même purge AVANT d'insérer sa ligne, dans la même transaction.
CREATE OR REPLACE FUNCTION enc_interdire_apres_mise_en_service() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EncMiseEnService") THEN
    RAISE EXCEPTION 'ENC_IMMUABLE : % interdit sur la table % après la mise en service', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  IF TG_LEVEL = 'ROW' THEN RETURN OLD; END IF;
  RETURN NULL;
END;
$$;

-- Séquences après mise en service : ni suppression, ni baisse, ni renommage.
CREATE OR REPLACE FUNCTION enc_sequence_garde() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "EncMiseEnService") THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'ENC_IMMUABLE : suppression de la séquence % interdite après la mise en service', OLD."cle" USING ERRCODE = 'P0001';
    END IF;
    IF NEW."cle" <> OLD."cle" OR NEW."valeur" < OLD."valeur" THEN
      RAISE EXCEPTION 'ENC_IMMUABLE : baisse ou renommage de la séquence % interdit après la mise en service', OLD."cle" USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- EncMiseEnService : jamais modifiée ni supprimée.
CREATE TRIGGER "enc_mise_en_service_immuable" BEFORE UPDATE OR DELETE ON "EncMiseEnService"
  FOR EACH ROW EXECUTE FUNCTION enc_interdire();
CREATE TRIGGER "enc_mise_en_service_truncate" BEFORE TRUNCATE ON "EncMiseEnService"
  FOR EACH STATEMENT EXECUTE FUNCTION enc_interdire();

-- EncAudit : UPDATE toujours interdit ; DELETE et TRUNCATE interdits après la mise en service.
CREATE TRIGGER "enc_audit_update" BEFORE UPDATE ON "EncAudit"
  FOR EACH ROW EXECUTE FUNCTION enc_interdire();
CREATE TRIGGER "enc_audit_delete" BEFORE DELETE ON "EncAudit"
  FOR EACH ROW EXECUTE FUNCTION enc_interdire_apres_mise_en_service();
CREATE TRIGGER "enc_audit_truncate" BEFORE TRUNCATE ON "EncAudit"
  FOR EACH STATEMENT EXECUTE FUNCTION enc_interdire_apres_mise_en_service();

-- EncSequence : après la mise en service, ni DELETE, ni baisse, ni TRUNCATE.
CREATE TRIGGER "enc_sequence_garde" BEFORE UPDATE OR DELETE ON "EncSequence"
  FOR EACH ROW EXECUTE FUNCTION enc_sequence_garde();
CREATE TRIGGER "enc_sequence_truncate" BEFORE TRUNCATE ON "EncSequence"
  FOR EACH STATEMENT EXECUTE FUNCTION enc_interdire_apres_mise_en_service();

-- Paramètres par défaut (source unique : backend/src/encParametres.ts). Le seed ne tourne qu'une fois en production :
-- la migration les pose donc aussi, sans jamais écraser une valeur déjà modifiée (ON CONFLICT DO NOTHING).
INSERT INTO "EncParametre" ("cle", "valeur") VALUES
  ('taxe.delai_exigibilite_mois', '1'),
  ('taxe.jour_limite_reversement', '20'),
  ('controle.tolerance_fcfa', '1'),
  ('taxe.rappel_jours_avant_limite', '5'),
  ('suspens.alerte_jours', '60')
ON CONFLICT ("cle") DO NOTHING;
