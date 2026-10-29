-- Journal technique : incidents d'envoi (e-mail, push), de tâches planifiées et de configuration (fiabilisation du
-- pointage, phase 3). Rejouable : types et table créés seulement s'ils n'existent pas.

DO $$ BEGIN
  CREATE TYPE "NiveauJournal" AS ENUM ('ERREUR', 'AVERTISSEMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SourceJournal" AS ENUM ('EMAIL', 'PUSH', 'TACHE', 'IMPORT', 'AUTRE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "JournalTechnique" (
    "id" TEXT NOT NULL,
    "niveau" "NiveauJournal" NOT NULL,
    "source" "SourceJournal" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contexte" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalTechnique_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JournalTechnique_createdAt_idx" ON "JournalTechnique"("createdAt");
CREATE INDEX IF NOT EXISTS "JournalTechnique_source_createdAt_idx" ON "JournalTechnique"("source", "createdAt");
