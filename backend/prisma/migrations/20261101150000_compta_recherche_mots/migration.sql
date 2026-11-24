-- Gestion Compta, lot GC-2d : recherche par début de mot des référentiels (clients, partenaires, produits).
-- Copié du patron d'Encaissements (20261004090000_encaissements_recherche_mots) ; sans extension PostgreSQL.

-- CreateTable : la colonne `mot` est créée en collation "C" (ajoutée à la main : Prisma ne la modélise pas et l'ignore à la
-- comparaison, `migrate diff` reste vide).
CREATE TABLE "CptMot" (
    "entite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "mot" TEXT COLLATE "C" NOT NULL,

    CONSTRAINT "CptMot_pkey" PRIMARY KEY ("entite","entiteId","mot")
);

-- CreateIndex : un btree ordinaire sur une colonne en collation "C" sert un LIKE 'x%', ce que la collation de la base
-- (en_US.utf8) empêche. Même effet que text_pattern_ops, que Prisma 7 ne sait déclarer que sous forme brute.
CREATE INDEX "CptMot_mot_entite_entiteId_idx" ON "CptMot"("mot", "entite", "entiteId");

-- Remplissage des fiches existantes (idempotent : ON CONFLICT DO NOTHING). Reproduit EXACTEMENT `motsIndexesCpt`
-- (backend/src/cptRecherche.ts) : texte en minuscules découpé sur les espaces ; pour chaque jeton, (1) le jeton sans
-- accents, apostrophes ni tirets, (2) ses parties séparées par apostrophe, tiret, barre, point ou souligné. Les deux listes
-- de caractères doivent rester identiques à ACCENTS/IGNORES/SANS_ACCENTS du fichier TypeScript. Les textes de chaque fiche
-- sont ceux de `textesIndexClientCpt` / `textesIndexPartenaireCpt` / `textesIndexProduitCpt` (téléphone sans le « + »).
INSERT INTO "CptMot" ("entite", "entiteId", "mot")
WITH textes AS (
    SELECT 'CLIENT' AS "entite", c."id" AS "entiteId",
           concat_ws(' ', c."nom", regexp_replace(c."telephone", '^\+', ''), c."pieceIdentite", c."tiersOdoo", p."nom") AS t
    FROM "CptClient" c
    LEFT JOIN "CptPartenaire" p ON p."id" = c."partenaireOrigineId"
    UNION ALL
    SELECT 'PARTENAIRE', p."id", concat_ws(' ', p."nom", p."coordonnees", p."tiersOdoo")
    FROM "CptPartenaire" p
    UNION ALL
    SELECT 'PRODUIT', x."id",
           concat_ws(' ', x."code", x."libelle",
                     CASE x."branche"::text WHEN 'ACCIDENTS' THEN 'Accidents' WHEN 'SANTE' THEN 'Santé' WHEN 'INCENDIE' THEN 'Incendie' WHEN 'DECES' THEN 'Décès' END,
                     x."compteOdoo")
    FROM "CptProduit" x
),
jetons AS (
    SELECT x."entite", x."entiteId", j
    FROM textes x, regexp_split_to_table(lower(x.t), '\s+') AS j
    WHERE j <> ''
)
SELECT "entite", "entiteId", m FROM (
    SELECT "entite", "entiteId", translate(j, 'éèêëàâäîïôöùûüç''’-', 'eeeeaaaiioouuuc') AS m FROM jetons
    UNION
    SELECT "entite", "entiteId", p FROM jetons, regexp_split_to_table(translate(j, 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc'), '[''’/._-]+') AS p
) mots
WHERE m <> ''
ON CONFLICT DO NOTHING;
