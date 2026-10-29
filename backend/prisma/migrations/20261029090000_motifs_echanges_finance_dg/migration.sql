-- Lot M (2026-10-29) : motif obligatoire (10 à 300 caractères) dans les deux sens Finance <-> DG.
-- Colonnes facultatives en base (les échanges antérieurs au lot M n'ont pas de motif : affichés « Non renseigné », jamais modifiés) ;
-- l'obligation est contrôlée côté serveur par chaque action. Additive et idempotente (rejouable sans effet).

ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "motifSoumissionDG" TEXT;
ALTER TABLE "Demande" ADD COLUMN IF NOT EXISTS "motifDecisionDG" TEXT;

ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "motifSoumissionDG" TEXT;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "motifDecisionDG" TEXT;

ALTER TABLE "BudgetParametrage" ADD COLUMN IF NOT EXISTS "motifSoumission" TEXT;
ALTER TABLE "BudgetParametrage" ADD COLUMN IF NOT EXISTS "motifDecision" TEXT;

ALTER TABLE "BudgetDepassement" ADD COLUMN IF NOT EXISTS "motifDemande" TEXT;
