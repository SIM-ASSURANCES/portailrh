-- Gestion Compta : écart entre le bordereau de production et les conventions (Q19, décision du 2026-11-27, registre C-39).
-- Le bordereau porte des montants de commission et de frais de gestion : ils sont enregistrés avec le contrat à sa création. Les
-- contrats déjà importés restent sans valeur (aucun rattrapage). L'alerte réutilise CptAlerteControle (unique objet, objetId,
-- palier : une seule alerte par contrat, nature et écart). Rejouable sans effet.

ALTER TABLE "CptContrat" ADD COLUMN IF NOT EXISTS "commissionDeclaree" DECIMAL(14,2);
ALTER TABLE "CptContrat" ADD COLUMN IF NOT EXISTS "gestionDeclaree" DECIMAL(14,2);

ALTER TYPE "CptObjetControle" ADD VALUE IF NOT EXISTS 'ECART_REMUNERATION';

ALTER TABLE "CptAlerteControle" ADD COLUMN IF NOT EXISTS "detail" JSONB;

INSERT INTO "CptParametre" ("cle", "valeur") VALUES
  ('remuneration.tolerance_ecart_fcfa', '0')
ON CONFLICT ("cle") DO NOTHING;
