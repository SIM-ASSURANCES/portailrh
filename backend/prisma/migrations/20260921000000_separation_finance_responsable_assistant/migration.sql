-- Separation stricte des taches Tresorerie : Responsable Finance (decide)
-- vs Assistant Finance (execute/manipule l'argent) -- voir CLAUDE.md
-- "Separation Responsable Finance / Assistant Finance". Choix produit
-- confirme, date 2026-09-21, pour reduire le risque de fraude (une seule
-- personne ne peut plus a la fois valider une depense ET la regler).
--
-- Idempotent de bout en bout (ON CONFLICT DO NOTHING partout) : sans
-- effet sur une base neuve, ou seed.ts fait deja tout correctement seul.
-- Rattrapage pour toute base deja seedee AVANT cette tache, que seed.ts
-- ne rejouera jamais (seed JAMAIS automatise en production apres l'init,
-- voir CLAUDE.md "Deploiement Docker/Dokploy").

-- 1. Isole "Alimenter la caisse" et "Definir/corriger le solde
--    d'ouverture" (jusqu'ici confondues avec treso.effectuer_reglement,
--    voir alimenterCaisseAction/definirSoldeOuvertureAction/
--    corrigerSoldeOuvertureAction) en deux permissions dediees.
INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-alimenter-caisse-rattrapage', 'treso.alimenter_caisse', 'Enregistrer une alimentation de caisse', m."id"
FROM "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" ("id", "key", "label", "moduleId")
SELECT 'permission-corriger-solde-ouverture-rattrapage', 'treso.corriger_solde_ouverture', 'Définir/corriger le solde d''ouverture de caisse', m."id"
FROM "Module" m
WHERE m."key" = 'tresorerie'
ON CONFLICT ("key") DO NOTHING;

-- 2. Le role "Finance" (Responsable Finance) possede les deux nouvelles
--    permissions par defaut -- aucune regression d'acces pour les comptes
--    Finance existants (il les avait deja implicitement via
--    treso.effectuer_reglement jusqu'ici).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" = 'Finance' AND p."key" IN ('treso.alimenter_caisse', 'treso.corriger_solde_ouverture')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 3. Nouveau role fixe "Assistant Finance" -- estAdmin=false,
--    peutRecevoirFeedback=true (comme les autres roles non-Admin),
--    peutEtreBeneficiaireDelegation=true DES LA CREATION (second cas
--    explicite apres "Collaborateur", voir CLAUDE.md "Delegation
--    individuelle de permissions" : un Responsable Finance doit pouvoir
--    lui deleguer au cas par cas l'alimentation de caisse/la correction
--    du solde d'ouverture/la depense directe).
INSERT INTO "Role" ("id", "name", "description", "estAdmin", "peutEtreBeneficiaireDelegation", "peutRecevoirFeedback")
VALUES (
  'role-assistant-finance-rattrapage',
  'Assistant Finance',
  'Exécute les règlements/décaissements et réceptionne les retours de caisse (séparation des tâches)',
  false,
  true,
  true
)
ON CONFLICT ("name") DO NOTHING;

-- 4. Le nouveau role recoit par defaut treso.effectuer_reglement et
--    treso.receptionner_retour -- jamais la validation, jamais par
--    defaut l'alimentation caisse/correction solde ouverture/depense
--    directe (delegables au cas par cas).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM "Role" r, "Permission" p
WHERE r."name" = 'Assistant Finance' AND p."key" IN ('treso.effectuer_reglement', 'treso.receptionner_retour')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- 5. Retrait DEFINITIF du role "Finance" -- choix produit assumé et daté
--    (2026-09-21), PAS un correctif de bug : le reglement/decaissement et
--    la reception de retour de caisse deviennent l'exclusivite du role
--    "Assistant Finance" ci-dessus.
DELETE FROM "RolePermission"
WHERE "roleId" IN (SELECT "id" FROM "Role" WHERE "name" = 'Finance')
  AND "permissionId" IN (
    SELECT "id" FROM "Permission" WHERE "key" IN ('treso.effectuer_reglement', 'treso.receptionner_retour')
  );
