-- Lot J bis : montants qu'une confirmation de dépassement du DG couvre (par article et par catégorie), pour que le règlement
-- de l'article ne soit pas refusé au-delà du reste du budget que le DG vient d'autoriser. Additive, rejouable, aucune écriture de caisse.
ALTER TABLE "BudgetDepassement" ADD COLUMN IF NOT EXISTS "couverture" JSONB;
