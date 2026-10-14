-- Lot G bis (2026-10-19) : un retour EXTERNE peut être rattaché à une demande et à son article (retour d'un fonds versé
-- par banque, rendu en espèces à la caisse). Purement additif et idempotent :
--  - RetourExterne.demandeId / ligneDemandeId (facultatifs, clés RESTRICT, index) ;
--  - les retours externes existants restent non rattachés (autonomes) ; aucune écriture de caisse n'est touchée.

ALTER TABLE "RetourExterne" ADD COLUMN IF NOT EXISTS "demandeId" TEXT;
ALTER TABLE "RetourExterne" ADD COLUMN IF NOT EXISTS "ligneDemandeId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RetourExterne_demandeId_fkey') THEN
    ALTER TABLE "RetourExterne" ADD CONSTRAINT "RetourExterne_demandeId_fkey"
      FOREIGN KEY ("demandeId") REFERENCES "Demande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RetourExterne_ligneDemandeId_fkey') THEN
    ALTER TABLE "RetourExterne" ADD CONSTRAINT "RetourExterne_ligneDemandeId_fkey"
      FOREIGN KEY ("ligneDemandeId") REFERENCES "LigneDemande"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "RetourExterne_demandeId_idx" ON "RetourExterne"("demandeId");
CREATE INDEX IF NOT EXISTS "RetourExterne_ligneDemandeId_idx" ON "RetourExterne"("ligneDemandeId");
