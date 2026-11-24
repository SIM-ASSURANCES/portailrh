-- Gestion Compta — valeurs par défaut des paramètres (lot GC-1b, docs/compta-conception.md §1.3 et §7).
-- Source unique : backend/src/cptParametres.ts (`CPT_PARAMETRES`) ; le test cptParametres.test.ts échoue si ce fichier diverge.
-- La production n'est seedée qu'une fois : la migration pose les défauts sur toute base, sans jamais écraser une valeur déjà
-- modifiée (ON CONFLICT DO NOTHING). Rejouable sans effet.

INSERT INTO "CptParametre" ("cle", "valeur") VALUES
  ('tca.jour_limite_paiement', '20'),
  ('rattachement.tolerance_montant_fcfa', '1'),
  ('rattachement.fenetre_avant_jours', '3'),
  ('rattachement.fenetre_apres_jours', '5'),
  ('rattachement.probable_ecart_taux', '0.02'),
  ('rattachement.probable_fenetre_jours', '45'),
  ('rattachement.reference_prefixe_caracteres', '12'),
  ('relance.jours', '7'),
  ('alerte.jours', '30'),
  ('escalade.jours', '60'),
  ('import.limite_lignes', '50000'),
  ('import.limite_taille_mo', '10')
ON CONFLICT ("cle") DO NOTHING;

-- Le jour limite de paiement de la taxe reste borné 1..28 aussi en base (comme l'exige la règle du mois le plus court).
-- Contrainte posée seulement si elle n'existe pas encore (rejouable).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CptParametre_jour_limite_borne') THEN
    -- CASE : seul moyen de garantir l'ordre d'évaluation (le cast ne doit jamais s'exécuter sur une autre clé ni sur un texte).
    ALTER TABLE "CptParametre" ADD CONSTRAINT "CptParametre_jour_limite_borne" CHECK (
      CASE
        WHEN "cle" <> 'tca.jour_limite_paiement' THEN true
        WHEN "valeur" ~ '^[0-9]{1,2}$' THEN "valeur"::integer BETWEEN 1 AND 28
        ELSE false
      END
    );
  END IF;
END
$$;
