-- Formulaire de demande (2026-10-09) : motif par ligne d'achat, et motif d'en-tête facultatif.
--
-- `LigneDemande.motif` (+ `motifOriginal`, `motifDemandeur`, mêmes versions que le libellé) : nullable en base, les
-- lignes existantes n'en ont pas ; obligatoire à la création et à la correction (contrôle applicatif).
-- `Demande.description` devient nullable : une nouvelle demande standard n'a plus de motif d'en-tête. Aucune donnée
-- supprimée ni réécrite : les anciennes demandes gardent leur motif d'en-tête, affiché en lecture seule.
-- Idempotente : rejouée, elle ne change rien.

ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "motif" TEXT;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "motifOriginal" TEXT;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "motifDemandeur" TEXT;
ALTER TABLE "Demande" ALTER COLUMN "description" DROP NOT NULL;
