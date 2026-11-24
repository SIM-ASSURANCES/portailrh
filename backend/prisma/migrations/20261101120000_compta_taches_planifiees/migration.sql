-- Gestion Compta, lot GC-1e (W1/W9) : trois tâches planifiées, enregistrées VIDES (aucun traitement avant GC-6/GC-8/GC-9).
-- Même mécanisme que RAPPELS_CONGES (migration 20261030090000) : ajout de valeurs d'enum, idempotent.
-- PostgreSQL interdit d'utiliser une valeur ajoutée dans la transaction qui l'ajoute : cette migration ne fait que l'ajout.
ALTER TYPE "TacheNom" ADD VALUE IF NOT EXISTS 'COMPTA_CONTROLE_HEBDO';
ALTER TYPE "TacheNom" ADD VALUE IF NOT EXISTS 'COMPTA_RELANCES';
ALTER TYPE "TacheNom" ADD VALUE IF NOT EXISTS 'COMPTA_RAPPEL_TCA';
