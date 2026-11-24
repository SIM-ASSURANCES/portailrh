-- Gestion Compta, lot GC-3c/3f : format d'import PRODUCTION par défaut.
--
-- Sans lui, `importerProductionCptAction` répond « aucun format de production par défaut » : l'écran de paramétrage des formats
-- n'existe pas encore. Un en-tête par champ interne du bordereau (libellé de `CHAMPS_PRODUCTION_CPT`), dates écrites en texte au
-- format JJ/MM/AAAA. Le JSON est la copie exacte de `formatProductionParDefautCpt()` (backend/src/cptProduction.ts) : le test
-- `cptFormatProductionDefaut.test.ts` échoue si l'un des deux change sans l'autre.
--
-- Idempotente : rien n'est posé si un format PRODUCTION par défaut existe déjà (index unique partiel « un défaut par type ») ou si le
-- nom est déjà pris (clé unique type + nom).

INSERT INTO "CptFormatImport" ("id", "type", "nom", "ligneEntete", "colonnes", "parDefaut", "actif", "majAt")
SELECT 'cptfmt_production_standard', 'PRODUCTION', 'Bordereau de production standard', 1, $json$[
  {"entete":"Numéro de police","champ":"numPolice","type":"texte","obligatoire":true},
  {"entete":"Identifiant de paiement (PaiementID)","champ":"paiementId","type":"texte","obligatoire":false},
  {"entete":"Type de contrat (individuel ou groupe)","champ":"natureContrat","type":"texte","obligatoire":false},
  {"entete":"Produit (code ou libellé)","champ":"produit","type":"texte","obligatoire":true},
  {"entete":"Type d'opération","champ":"typeOperation","type":"texte","obligatoire":false},
  {"entete":"Client","champ":"client","type":"texte","obligatoire":false},
  {"entete":"Téléphone du client","champ":"telephone","type":"texte","obligatoire":false},
  {"entete":"Partenaire apporteur","champ":"partenaire","type":"texte","obligatoire":false},
  {"entete":"Fractionnement","champ":"fractionnement","type":"texte","obligatoire":false},
  {"entete":"Date d'effet","champ":"dateEffet","type":"date","obligatoire":true,"formatDate":"JJ/MM/AAAA"},
  {"entete":"Date d'échéance","champ":"dateEcheance","type":"date","obligatoire":true,"formatDate":"JJ/MM/AAAA"},
  {"entete":"Mode de paiement déclaré","champ":"modePaiement","type":"texte","obligatoire":false},
  {"entete":"Référence de paiement déclarée","champ":"referencePaiement","type":"texte","obligatoire":false},
  {"entete":"Date de paiement déclarée","champ":"datePaiement","type":"date","obligatoire":false,"formatDate":"JJ/MM/AAAA"},
  {"entete":"Prime TTC","champ":"primeTtc","type":"montant","obligatoire":true},
  {"entete":"Prime hors taxe","champ":"primeHt","type":"montant","obligatoire":false},
  {"entete":"Accessoires","champ":"accessoires","type":"montant","obligatoire":false},
  {"entete":"Taxe","champ":"taxe","type":"montant","obligatoire":false},
  {"entete":"Commission déclarée","champ":"commission","type":"montant","obligatoire":false},
  {"entete":"Frais de gestion déclarés","champ":"gestion","type":"montant","obligatoire":false},
  {"entete":"Montant payé déclaré","champ":"montantPaye","type":"montant","obligatoire":false}
]$json$::jsonb, true, true, now()
WHERE NOT EXISTS (SELECT 1 FROM "CptFormatImport" WHERE "type" = 'PRODUCTION' AND "parDefaut")
  AND NOT EXISTS (SELECT 1 FROM "CptFormatImport" WHERE "type" = 'PRODUCTION' AND "nom" = 'Bordereau de production standard');
