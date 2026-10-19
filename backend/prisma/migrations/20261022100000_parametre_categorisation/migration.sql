-- Lot I (2026-10-19) : paramètres Trésorerie modifiables par la Finance, dont la date à partir de laquelle la
-- catégorisation est obligatoire pour valider. La valeur est posée à NULL (= jamais obligatoire) : après déploiement,
-- rien n'est bloqué tant que la Finance n'a pas fixé de date. Additive et idempotente.
CREATE TABLE IF NOT EXISTS "ParametreTresorerie" (
    "cle" TEXT NOT NULL,
    "valeurDate" DATE,
    "majAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majParId" TEXT,

    CONSTRAINT "ParametreTresorerie_pkey" PRIMARY KEY ("cle")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ParametreTresorerie_majParId_fkey') THEN
    ALTER TABLE "ParametreTresorerie"
      ADD CONSTRAINT "ParametreTresorerie_majParId_fkey" FOREIGN KEY ("majParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "ParametreTresorerie" ("cle", "valeurDate") VALUES ('categorisation.obligatoire_a_partir_du', NULL)
ON CONFLICT ("cle") DO NOTHING;
