-- Autonomie des articles, lot A (2026-10-14) : bénéficiaire et pièces jointes PAR ARTICLE. Purement additive :
-- aucune donnée détruite, aucune valeur par défaut nécessaire.
--  - LigneDemande.beneficiaireType / beneficiaireUserId / beneficiaireNom : bénéficiaire propre à l'article ; vide
--    (beneficiaireType NULL) = l'article hérite du bénéficiaire par défaut de la demande (Demande.beneficiaire*, conservé).
--    Toutes les lignes existantes restent donc sur « hérite » : rien ne change pour les demandes déjà en base.
--  - PieceJointe.ligneDemandeId : pièce propre à un article (plusieurs possibles), SET NULL si l'article disparaît.
-- Aucun changement sur Reglement, ni sur les étapes, décisions et permissions du circuit.
-- Idempotente : rejouée, elle ne change rien.

ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "beneficiaireType" "BeneficiaireType";
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "beneficiaireUserId" TEXT;
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "beneficiaireNom" TEXT;
ALTER TABLE "PieceJointe" ADD COLUMN IF NOT EXISTS "ligneDemandeId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LigneDemande_beneficiaireUserId_fkey') THEN
    ALTER TABLE "LigneDemande" ADD CONSTRAINT "LigneDemande_beneficiaireUserId_fkey"
      FOREIGN KEY ("beneficiaireUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PieceJointe_ligneDemandeId_fkey') THEN
    ALTER TABLE "PieceJointe" ADD CONSTRAINT "PieceJointe_ligneDemandeId_fkey"
      FOREIGN KEY ("ligneDemandeId") REFERENCES "LigneDemande"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LigneDemande_beneficiaireUserId_idx" ON "LigneDemande"("beneficiaireUserId");
CREATE INDEX IF NOT EXISTS "PieceJointe_ligneDemandeId_idx" ON "PieceJointe"("ligneDemandeId");
