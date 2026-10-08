-- Commit 4e : codes de branche lus dans le fichier, enregistrés sur l'import (additive, nullable).
ALTER TABLE "EncImport" ADD COLUMN "branchesFichier" JSONB;
