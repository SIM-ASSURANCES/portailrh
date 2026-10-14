-- Planificateur intégré : une ligne par exécution d'une tâche planifiée (fiabilisation du pointage, phase 2).
-- Rejouable : les types et la table sont créés seulement s'ils n'existent pas.

DO $$ BEGIN
  CREATE TYPE "TacheNom" AS ENUM ('RELANCES_JUSTIFICATION', 'ABSENCES', 'PURGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeclenchementTache" AS ENUM ('PLANIFICATEUR', 'MANUEL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "StatutExecutionTache" AS ENUM ('SUCCES', 'ECHEC', 'IGNOREE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ExecutionTache" (
    "id" TEXT NOT NULL,
    "tache" "TacheNom" NOT NULL,
    "declenchement" "DeclenchementTache" NOT NULL,
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "statut" "StatutExecutionTache" NOT NULL,
    "bilan" JSONB,
    "erreur" TEXT,

    CONSTRAINT "ExecutionTache_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExecutionTache_tache_debut_idx" ON "ExecutionTache"("tache", "debut");
