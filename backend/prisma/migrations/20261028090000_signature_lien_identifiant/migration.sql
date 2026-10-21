-- Lot L bis : la signature d'une action est liée à ses événements PAR IDENTIFIANT (plus de fenêtre de temps).
--
-- 1. HistoriqueEntry.actionSigneeId : l'action signée dont la ligne d'historique est une conséquence (posée dans la même
--    transaction que l'action, voir backend/src/signatureTransaction.ts). Additif : colonne facultative, aucune ligne réécrite
--    par la partie structure.
-- 2. Reprise des données du lot L (UNE DERNIÈRE FOIS, l'ancienne logique) : une ligne d'historique d'une action signée, postérieure
--    à la mise en service des signatures et sans lien, est rattachée à l'action signée du MÊME compte, enregistrée dans la minute,
--    de la même demande quand les deux la connaissent. Si plusieurs actions DIFFÉRENTES (autre version de signature ou autre titulaire)
--    sont candidates, on ne devine pas : la ligne reste « Signature non rattachée ». Deux candidates équivalentes (même version, même
--    titulaire — cas des anciens clics qui laissaient deux enregistrements) donnent la même signature : la plus proche est retenue.
--    Aucune écriture d'une table autre que HistoriqueEntry.actionSigneeId ; le journal de caisse n'est jamais touché ; les lignes
--    antérieures à la mise en service restent « Antérieur à la signature ». Rejouable sans effet (seules les lignes sans lien sont vues).

ALTER TABLE "HistoriqueEntry" ADD COLUMN IF NOT EXISTS "actionSigneeId" TEXT;
CREATE INDEX IF NOT EXISTS "HistoriqueEntry_actionSigneeId_idx" ON "HistoriqueEntry"("actionSigneeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HistoriqueEntry_actionSigneeId_fkey') THEN
    ALTER TABLE "HistoriqueEntry"
      ADD CONSTRAINT "HistoriqueEntry_actionSigneeId_fkey" FOREIGN KEY ("actionSigneeId") REFERENCES "ActionSignee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

WITH signables(action) AS (
  VALUES
    ('validation_service'), ('renvoi_correction'), ('soumission_dg'), ('resoumission_dg'), ('validation_dg'), ('rejet_dg'),
    ('decision_circuit'), ('soumission_lignes_dg'), ('decision_ligne_dg'), ('validation_ligne'), ('rejet_ligne'),
    ('validation_ligne_dg'), ('refus_ligne_dg'), ('reorientation_service'), ('reprise_etape'), ('validation'),
    ('validation_complementaire'), ('rejet_demande'), ('rejet_reliquat'), ('validation_depense_directe'), ('cloture_totale'),
    ('cloture_partielle'), ('cloture_forcee'), ('validation_complete_dg'), ('rejet_validation_complete'),
    ('annulation_validation_complete'), ('resoumission_validation_complete'), ('reglement'), ('annulation_reglement'),
    ('reception_retour'), ('retour_nul_constate'), ('declaration_retour_assistant'), ('remboursement_retour_valide'),
    ('remboursement_retour_rejete'), ('retour_exceptionnel_post_cloture'), ('retour_exceptionnel_rejete'), ('retour_externe_rattache')
),
mise AS (
  SELECT "creeAt" AS depuis FROM "MarqueurUnique" WHERE "cle" = 'signatures.mise_en_service'
),
entrees AS (
  SELECT h."id" AS hid, h."userId", h."createdAt",
         CASE WHEN h."entity" = 'Demande' THEN h."entityId" WHEN h."entity" = 'LigneDemande' THEN l."demandeId" END AS demande_id
  FROM "HistoriqueEntry" h
  JOIN signables s ON s.action = h."action"
  LEFT JOIN "LigneDemande" l ON h."entity" = 'LigneDemande' AND l."id" = h."entityId"
  WHERE h."actionSigneeId" IS NULL
    AND h."createdAt" >= (SELECT depuis FROM mise)
),
candidates AS (
  SELECT e.hid, a."id" AS aid, a."creeAt", a."signatureId", COALESCE(a."auNomDeId", '') AS titulaire,
         abs(extract(epoch FROM (a."creeAt" - e."createdAt"))) AS ecart
  FROM entrees e
  JOIN "ActionSignee" a ON a."signataireId" = e."userId"
   AND abs(extract(epoch FROM (a."creeAt" - e."createdAt"))) <= 60
   AND (a."demandeId" IS NULL OR e.demande_id IS NULL OR a."demandeId" = e.demande_id)
),
sans_ambiguite AS (
  SELECT hid FROM candidates GROUP BY hid HAVING COUNT(DISTINCT ("signatureId" || '|' || titulaire)) = 1
),
choisies AS (
  SELECT DISTINCT ON (c.hid) c.hid, c.aid
  FROM candidates c
  JOIN sans_ambiguite s ON s.hid = c.hid
  ORDER BY c.hid, c.ecart, c."creeAt", c.aid
)
UPDATE "HistoriqueEntry" h SET "actionSigneeId" = choisies.aid FROM choisies WHERE h."id" = choisies.hid;

-- 3. Les actions signées qui CRÉENT une entité (retour déclaré par l'Assistant, retour externe) désignent désormais cette entité par
--    son identifiant (`ActionSignee.entiteId`). Les enregistrements du lot L visaient le règlement (déclaration) ou rien (retour
--    externe) : on les rattache à l'entité créée par le même compte dans la minute, SEULEMENT s'il n'y en a qu'une (sinon rien n'est
--    deviné). Rejouable sans effet : seuls les enregistrements encore dans l'ancien état sont vus.
UPDATE "ActionSignee" a
SET "entite" = 'RetourCaisse', "entiteId" = x.rid
FROM (
  SELECT a2."id" AS aid, MIN(r."id") AS rid
  FROM "ActionSignee" a2
  JOIN "RetourCaisse" r ON r."reglementId" = a2."entiteId" AND r."creeParAssistant" = true AND r."declarantId" = a2."signataireId"
   AND abs(extract(epoch FROM (r."createdAt" - a2."creeAt"))) <= 60
  WHERE a2."action" = 'declaration_retour_assistant' AND a2."entite" = 'Reglement'
  GROUP BY a2."id"
  HAVING COUNT(r."id") = 1
) x
WHERE a."id" = x.aid;

UPDATE "ActionSignee" a
SET "entiteId" = x.rid
FROM (
  SELECT a2."id" AS aid, MIN(r."id") AS rid
  FROM "ActionSignee" a2
  JOIN "RetourExterne" r ON r."creeParId" = a2."signataireId"
   AND abs(extract(epoch FROM (r."creeAt" - a2."creeAt"))) <= 60
   AND r."demandeId" IS NOT DISTINCT FROM a2."demandeId"
  WHERE a2."action" = 'retour_externe' AND a2."entiteId" IS NULL
  GROUP BY a2."id"
  HAVING COUNT(r."id") = 1
) x
WHERE a."id" = x.aid;
