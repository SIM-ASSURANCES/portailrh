-- Paramètres V2 (docs/encaissements-conception.md §5.2, CDC V2.6 §3.6, F9) : branches, bénéficiaire des honoraires
-- daté, partenaires (partage des accessoires), taux de contrôle. Migration CORRECTIVE : ne modifie jamais les
-- migrations `20260927100000_encaissements_module` / `20260927142216_encaissements_socle_technique` déjà poussées.
-- Sans écran (le F9 arrive au Lot 3) — schéma, contrôle applicatif (encReferentiels.ts) et actions serveur seulement.

-- CreateTable
CREATE TABLE "EncBranche" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncBranche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncBeneficiaireHonoraires" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "creeParId" TEXT,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EncBeneficiaireHonoraires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncPartenaire" (
    "id" TEXT NOT NULL,
    "cleNom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "partAccessoiresPartenaire" DECIMAL(7,6),
    "creeParId" TEXT NOT NULL,
    "creeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "majParId" TEXT,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncPartenaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncTauxControle" (
    "id" TEXT NOT NULL,
    "produitCode" TEXT,
    "partenaireId" TEXT,
    "tauxTaxe" DECIMAL(7,6),
    "tauxCommission" DECIMAL(7,6),
    "tauxAccessoires" DECIMAL(7,6),
    "tauxHonoraires" DECIMAL(7,6),
    "majParId" TEXT NOT NULL,
    "majAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EncTauxControle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EncBranche_code_key" ON "EncBranche"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EncBeneficiaireHonoraires_dateDebut_key" ON "EncBeneficiaireHonoraires"("dateDebut");

-- CreateIndex
CREATE UNIQUE INDEX "EncPartenaire_cleNom_key" ON "EncPartenaire"("cleNom");

-- CreateIndex (n'empêche que le doublon EXACT produit+partenaire — voir la note NULL sur le modèle, schema.prisma)
CREATE UNIQUE INDEX "EncTauxControle_produitCode_partenaireId_key" ON "EncTauxControle"("produitCode", "partenaireId");

-- CreateIndex
CREATE INDEX "EncTauxControle_produitCode_idx" ON "EncTauxControle"("produitCode");

-- CreateIndex
CREATE INDEX "EncTauxControle_partenaireId_idx" ON "EncTauxControle"("partenaireId");

-- AddForeignKey
ALTER TABLE "EncBranche" ADD CONSTRAINT "EncBranche_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncBeneficiaireHonoraires" ADD CONSTRAINT "EncBeneficiaireHonoraires_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncPartenaire" ADD CONSTRAINT "EncPartenaire_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncPartenaire" ADD CONSTRAINT "EncPartenaire_majParId_fkey" FOREIGN KEY ("majParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncTauxControle" ADD CONSTRAINT "EncTauxControle_partenaireId_fkey" FOREIGN KEY ("partenaireId") REFERENCES "EncPartenaire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncTauxControle" ADD CONSTRAINT "EncTauxControle_majParId_fkey" FOREIGN KEY ("majParId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================================================
-- Ajouts manuels (docs/encaissements-conception.md §5.2) — non générés par Prisma.
-- =====================================================================================================================

-- Un taux de contrôle porte toujours sur au moins un produit ou un partenaire (`verifierCleTauxControle`,
-- encReferentiels.ts, revérifie la même règle côté application) — aucun contrôle "global" décrit par le cahier,
-- jamais les deux nuls à la fois. Filet de sécurité en base, en plus du contrôle applicatif.
ALTER TABLE "EncTauxControle" ADD CONSTRAINT "EncTauxControle_cle_non_vide" CHECK ("produitCode" IS NOT NULL OR "partenaireId" IS NOT NULL);

-- Le jour limite de reversement des taxes doit rester borné 1..28 même écrit hors de l'application (script direct,
-- accès SQL) — l'application (encParametres.ts) l'imposait déjà à l'écriture, ce CHECK le garantit aussi en base.
-- Validé automatiquement par Postgres sur les lignes existantes : la valeur par défaut ('20') le respecte déjà, et
-- aucun écran n'a jamais permis de l'écrire hors bornes (F9 pas encore construit) — sans risque d'échec ici.
ALTER TABLE "EncParametre" ADD CONSTRAINT "EncParametre_jour_limite_borne" CHECK (
  "cle" <> 'taxe.jour_limite_reversement' OR ("valeur" ~ '^[0-9]+$' AND "valeur"::integer BETWEEN 1 AND 28)
);

-- Retire le délai d'exigibilité des paramètres modifiables : N+1 est désormais fixe (CDC V2.6 §5.3, encCalcul.ts),
-- jamais paramétrable — cette clé n'existe plus dans ENC_PARAMETRES (encParametres.ts).
DELETE FROM "EncParametre" WHERE "cle" = 'taxe.delai_exigibilite_mois';

-- Part partenaire par défaut des accessoires (0 % par défaut — SIM garde 100% des accessoires tant que Finance n'a
-- paramétré ni taux par défaut ni taux propre à un partenaire). Branché sur `choisirTauxAccessoires` (encCalcul.ts)
-- via `tauxAccessoiresDefaut` (encParametres.ts).
INSERT INTO "EncParametre" ("cle", "valeur") VALUES ('accessoires.part_partenaire_defaut', '0') ON CONFLICT ("cle") DO NOTHING;

-- Bénéficiaire des honoraires : NOVELIA, posé une seule fois par cette migration (`creeParId` nul — aucun utilisateur
-- réel à cet instant, seul cas où ce champ est nul). Date de début choisie PROVISOIREMENT au 2000-01-01 comme repère
-- "depuis toujours" (le cahier décrit NOVELIA comme le bénéficiaire actuel sans donner de date d'origine réelle ; à
-- confirmer avec le client si une vraie date existe). Source unique de cette valeur :
-- `ENC_BENEFICIAIRE_HONORAIRES_INITIAL` (encReferentiels.ts) — ne pas la faire diverger de cette migration.
INSERT INTO "EncBeneficiaireHonoraires" ("id", "nom", "dateDebut", "creeAt")
VALUES ('enc-beneficiaire-novelia-bootstrap', 'NOVELIA', '2000-01-01', CURRENT_TIMESTAMP)
ON CONFLICT ("dateDebut") DO NOTHING;
