-- Lot G (2026-10-14) : date de livraison PAR ARTICLE. Purement additive, aucune reprise des articles existants
-- (leur date reste vide, affichée « — »). La date commune de la demande (Demande.dateLivraisonSouhaitee) est inchangée.
ALTER TABLE "LigneDemande" ADD COLUMN IF NOT EXISTS "dateLivraison" DATE;
