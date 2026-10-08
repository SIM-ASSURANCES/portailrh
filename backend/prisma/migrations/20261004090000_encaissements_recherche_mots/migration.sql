-- Recherche par début de mot (F2, commit 5a-bis, option B) — sans extension PostgreSQL.

-- CreateTable
CREATE TABLE "EncContratMot" (
    "contratId" TEXT NOT NULL,
    "mot" TEXT COLLATE "C" NOT NULL,

    CONSTRAINT "EncContratMot_pkey" PRIMARY KEY ("contratId","mot")
);

-- CreateIndex : colonne en collation "C" (ajoutée à la main ci-dessus, Prisma ne la modélise pas et l'ignore à la
-- comparaison) : un btree ordinaire sert alors un LIKE 'x%', ce que la collation de la base (en_US.utf8) empêche.
-- Même effet que text_pattern_ops, que Prisma 7 ne sait déclarer que sous forme brute (raw) et voit comme un écart
-- permanent (migrate dev proposerait de recréer l'index à chaque nouvelle migration).
CREATE INDEX "EncContratMot_mot_contratId_idx" ON "EncContratMot"("mot", "contratId");

-- AddForeignKey
ALTER TABLE "EncContratMot" ADD CONSTRAINT "EncContratMot_contratId_fkey" FOREIGN KEY ("contratId") REFERENCES "EncContrat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remplissage des contrats existants (idempotent : ON CONFLICT DO NOTHING). Reproduit EXACTEMENT `motsIndexes`
-- (backend/src/encRecherche.ts) : texte en minuscules découpé sur les espaces ; pour chaque jeton, (1) le jeton
-- sans accents, apostrophes ni tirets, (2) ses parties séparées par apostrophe, tiret, barre, point ou souligné.
-- Les deux listes de caractères doivent rester identiques à ACCENTS/IGNORES/SANS_ACCENTS du fichier TypeScript.
INSERT INTO "EncContratMot" ("contratId", "mot")
WITH textes AS (
    SELECT c."id", concat_ws(' ', c."numPolice", c."clientNom", c."clientId", c."produitLibelle", c."produitCode",
                             p."nom", b."code", b."libelle") AS t
    FROM "EncContrat" c
    JOIN "EncBranche" b ON b."id" = c."brancheId"
    LEFT JOIN "EncPartenaire" p ON p."id" = c."partenaireId"
    UNION ALL
    SELECT e."contratId", e."reference"
    FROM "EncEncaissement" e
    WHERE e."reference" IS NOT NULL
),
jetons AS (
    SELECT x."id", j
    FROM textes x, regexp_split_to_table(lower(x.t), '\s+') AS j
    WHERE j <> ''
)
SELECT "id", m FROM (
    SELECT "id", translate(j, 'éèêëàâäîïôöùûüç''’-', 'eeeeaaaiioouuuc') AS m FROM jetons
    UNION
    SELECT "id", p FROM jetons, regexp_split_to_table(translate(j, 'éèêëàâäîïôöùûüç', 'eeeeaaaiioouuuc'), '[''’/._-]+') AS p
) mots
WHERE m <> ''
ON CONFLICT DO NOTHING;
