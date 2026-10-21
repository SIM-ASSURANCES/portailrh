-- Lot I (2026-10-19) : motif / nature du règlement. Colonne facultative en base : les règlements antérieurs restent
-- sans motif (jamais bloqués ni modifiés, affichés « Non renseigné ») ; l'obligation (5 caractères) est appliquée par
-- l'application à tout NOUVEAU règlement. Additive et idempotente. Aucune écriture de caisse touchée.
ALTER TABLE "Reglement" ADD COLUMN IF NOT EXISTS "motif" TEXT;
