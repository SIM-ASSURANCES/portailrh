-- Lot D (2026-10-16) — comptage EN LECTURE SEULE à lancer en production AVANT le déploiement (la colonne
-- "Reglement"."ligneDemandeId" n'existe pas encore : cette requête ne l'utilise pas). Aucune écriture.
--
-- Pour chaque cas, le nombre de demandes concernées et de règlements :
--   • « rattachés par la migration » : demandes dont UN SEUL article est validé — la migration
--     20261016090000_reglement_par_article rattache tous leurs règlements à cet article, sans doute possible ;
--   • « AMBIGUS » : demandes avec DEUX articles validés ou plus et au moins un règlement non annulé — rien n'est
--     rattaché automatiquement ; tant qu'ils existent, plus aucun règlement n'est possible sur ces demandes
--     (l'annulation reste possible) jusqu'au rattachement à la main (script recalculer-reglements-articles.ts).
WITH v AS (
  SELECT "demandeId", COUNT(*) AS valides
  FROM "LigneDemande"
  WHERE "statutValidation" = 'VALIDEE'
  GROUP BY "demandeId"
),
r AS (
  SELECT "demandeId", COUNT(*) AS total, COUNT(*) FILTER (WHERE NOT "estAnnule") AS ouverts
  FROM "Reglement"
  GROUP BY "demandeId"
)
SELECT
  CASE WHEN v.valides = 1 THEN 'rattachés par la migration (un seul article validé)' ELSE 'AMBIGUS (≥ 2 articles validés)' END AS cas,
  COUNT(*) AS demandes,
  SUM(CASE WHEN v.valides = 1 THEN r.total ELSE r.ouverts END) AS reglements
FROM v
JOIN r USING ("demandeId")
WHERE v.valides = 1 OR r.ouverts > 0
GROUP BY 1
ORDER BY 1;

-- Détail des demandes AMBIGUËS (référence, articles validés, règlements non annulés) :
SELECT d."reference", v.valides AS articles_valides, r.ouverts AS reglements_non_annules
FROM "Demande" d
JOIN (SELECT "demandeId", COUNT(*) AS valides FROM "LigneDemande" WHERE "statutValidation" = 'VALIDEE' GROUP BY "demandeId") v
  ON v."demandeId" = d."id"
JOIN (SELECT "demandeId", COUNT(*) FILTER (WHERE NOT "estAnnule") AS ouverts FROM "Reglement" GROUP BY "demandeId") r
  ON r."demandeId" = d."id"
WHERE v.valides >= 2 AND r.ouverts > 0
ORDER BY d."reference";
