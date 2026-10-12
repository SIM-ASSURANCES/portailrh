-- Encaissements, commit 6-0 (2026-10-08) : index de `EncSignalement` pour l'onglet « À vérifier » (statut + date,
-- plus anciens d'abord) et la fiche police (signalements retrouvés par n° de police). Purement additive ; rejouée,
-- elle ne recrée rien.

CREATE INDEX IF NOT EXISTS "EncSignalement_statut_creeAt_idx" ON "EncSignalement"("statut", "creeAt");
CREATE INDEX IF NOT EXISTS "EncSignalement_numPolice_idx" ON "EncSignalement"("numPolice");
