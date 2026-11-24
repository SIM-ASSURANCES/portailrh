#!/usr/bin/env bash
# Gestion Compta, lot GC-3g : temps des requêtes de l'écran « Production » (/compta/production) sur DIX ANS de données synthétiques,
# base PostgreSQL 16 JETABLE (conteneur créé puis supprimé ici, jamais la base de développement).
#   150 000 contrats répartis sur 10 ans, 4 échéances chacun, 120 imports (un par mois), 300 000 anomalies dont 60 000 à traiter,
#   6 mots d'index de recherche par contrat. Chaque requête de la page est chronométrée par EXPLAIN ANALYZE ; seuil : 300 ms.
# Usage : bash e2e/compta-gc3g-explain.sh      (Docker requis ; port COMPTA_PG_PORT, 55499 par défaut ; COMPTA_N pour changer le volume)
set -euo pipefail
cd "$(dirname "$0")/.."

NOM="pg-compta-gc3g"
PORT="${COMPTA_PG_PORT:-55499}"
N="${COMPTA_N:-150000}"
SEUIL_MS="${COMPTA_SEUIL_MS:-300}"
nettoyer() { docker rm -f "$NOM" >/dev/null 2>&1 || true; }
trap nettoyer EXIT
nettoyer

docker run -d --rm --name "$NOM" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=compta -p "$PORT":5432 postgres:16 >/dev/null
for _ in $(seq 1 60); do
  [ "$(docker logs "$NOM" 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break
  sleep 1
done
sleep 1

export DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta?schema=public"
echo "== Migrations depuis zéro =="
(cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror")

psql_cpt() { docker exec -i "$NOM" psql -U postgres -d compta -v ON_ERROR_STOP=1 -q -t -A "$@"; }

echo "== Jeu de données : $N contrats sur 10 ans =="
psql_cpt <<SQL
INSERT INTO "Role" ("id", "name") VALUES ('r-test', 'Rôle de test');
INSERT INTO "User" ("id", "fullName", "email", "roleId", "updatedAt") VALUES ('u-test', 'Compte de test', 'gc3g@simassurances.test', 'r-test', now());
INSERT INTO "CptPartenaire" ("id", "nom", "estApporteur", "majAt") SELECT 'p-' || g, 'Courtier ' || g, true, now() FROM generate_series(1, 40) g;
INSERT INTO "CptProduit" ("id", "code", "libelle", "branche", "majAt") SELECT 'pr-' || g, 'P' || g, 'Produit ' || g, 'ACCIDENTS', now() FROM generate_series(1, 25) g;
INSERT INTO "CptClient" ("id", "nom", "majAt") SELECT 'cl-' || g, 'Client ' || g, now() FROM generate_series(1, 60000) g;

-- 120 imports (un par mois, depuis dix ans), chacun avec sa pièce jointe.
INSERT INTO "CptPieceJointe" ("id", "url", "mime", "taille", "sha256", "deposeeParId")
  SELECT 'pj-' || g, 'uploads/f' || g || '.csv', 'text/csv', 1000, 'sha-' || g, 'u-test' FROM generate_series(1, 120) g;
INSERT INTO "CptImport" ("id", "type", "fichierId", "empreinte", "creeParId", "creeAt", "bilan")
  SELECT 'i-' || g, 'PRODUCTION', 'pj-' || g, 'emp-' || g, 'u-test', now() - (g || ' months')::interval,
         jsonb_build_object('lignesLues', 1250, 'contratsCrees', 1250, 'lignesRejetees', 0, 'anomaliesCreees', 2500)
  FROM generate_series(1, 120) g;

-- Contrats : date de création étalée sur dix ans, rattachés à l'import du mois.
INSERT INTO "CptContrat" ("id","numPolice","produitId","natureContrat","clientId","partenaireApporteurId","dateEffet","dateEcheance",
  "fractionnement","primeNetteHt","primeTtc","creeParId","majAt","importId","creeAt")
  SELECT 'k-' || g, 'POL-' || lpad(g::text, 8, '0'), 'pr-' || (1 + g % 25), 'INDIVIDUEL', 'cl-' || (1 + g % 60000), 'p-' || (1 + g % 40),
         (now() - ((g % 3650) || ' days')::interval)::date, (now() - ((g % 3650) || ' days')::interval)::date + 364,
         'TRIMESTRIEL', 100000 + (g % 50) * 1000, 107250 + (g % 50) * 1000, 'u-test', now(), 'i-' || (1 + g % 120),
         now() - ((g * 3650.0 / $N) || ' days')::interval
  FROM generate_series(1, $N) g;

INSERT INTO "CptEcheance" ("id","contratId","rang","periodeDebut","periodeFin","datePrevue","primeTtc","primeHt","montantDu","etat","majAt")
  SELECT 'e-' || c.id || '-' || r, c.id, r, (c."dateEffet" + (r - 1) * 91), (c."dateEffet" + (r - 1) * 91) + 89, (c."dateEffet" + (r - 1) * 91),
         26812, 25000, 26812, (CASE WHEN r = 1 THEN 'SOLDEE' ELSE 'OUVERTE' END)::"CptEtatEcheance", now()
  FROM "CptContrat" c, generate_series(1, 4) r;

-- 300 000 anomalies, 20 % à traiter.
INSERT INTO "CptAnomalie" ("id","type","objetEntite","objetId","detail","statut","importId","traiteeParId","traiteeAt","resolution","creeAt")
  SELECT 'a-' || g, 'PARTENAIRE_INCONNU', 'CONTRAT', 'k-' || (1 + g % $N),
         jsonb_build_object('numPolice', 'POL-' || lpad(((1 + g % $N))::text, 8, '0'), 'numeroLigne', g % 1250, 'message', 'x'),
         (CASE WHEN g % 5 = 0 THEN 'A_TRAITER' ELSE 'TRAITEE' END)::"CptStatutAnomalie", 'i-' || (1 + g % 120),
         CASE WHEN g % 5 = 0 THEN NULL ELSE 'u-test' END, CASE WHEN g % 5 = 0 THEN NULL ELSE now() END, CASE WHEN g % 5 = 0 THEN NULL ELSE 'Vu' END,
         now() - ((g * 3650.0 / 300000) || ' days')::interval
  FROM generate_series(1, 300000) g;

-- Index de recherche : police et ses parties, client, apporteur (colonne « mot » en collation C, posée par la migration).
INSERT INTO "CptMot" ("entite","entiteId","mot")
  SELECT 'CONTRAT', 'k-' || g, m FROM generate_series(1, $N) g,
    LATERAL unnest(ARRAY['pol' || lpad(g::text, 8, '0'), 'pol', lpad(g::text, 8, '0'), 'client', (1 + g % 60000)::text, 'courtier' || (1 + g % 40)]) m
  ON CONFLICT DO NOTHING;
ANALYZE;
SQL

echo "== Temps des requêtes de l'écran (EXPLAIN ANALYZE, seuil ${SEUIL_MS} ms) =="
KO=0
mesurer() { # mesurer "libellé" "requête"
  local ms
  ms="$(psql_cpt -c "EXPLAIN (ANALYZE, TIMING OFF) $2" | grep -E "^Execution Time" | sed -E 's/Execution Time: ([0-9.]+) ms/\1/')"
  local entier="${ms%.*}"
  if [ "${entier:-99999}" -lt "$SEUIL_MS" ]; then echo "OK  $1 — ${ms} ms"; else echo "KO  $1 — ${ms} ms (seuil ${SEUIL_MS})"; KO=1; fi
}
mesurer "compteur « Contrats enregistrés »" 'SELECT count(*) FROM "CptContrat"'
mesurer "compteur « Imports de production »" "SELECT count(*) FROM \"CptImport\" WHERE type = 'PRODUCTION'"
mesurer "compteur « Anomalies à traiter »" "SELECT count(*) FROM \"CptAnomalie\" WHERE statut = 'A_TRAITER'"
mesurer "50 contrats récents (tri sur la date de création)" 'SELECT * FROM "CptContrat" ORDER BY "creeAt" DESC, "numPolice" ASC LIMIT 50'
mesurer "20 derniers imports" "SELECT * FROM \"CptImport\" WHERE type = 'PRODUCTION' ORDER BY \"creeAt\" DESC LIMIT 20"
mesurer "50 anomalies à traiter les plus récentes" "SELECT * FROM \"CptAnomalie\" WHERE statut = 'A_TRAITER' ORDER BY \"creeAt\" DESC LIMIT 50"
mesurer "recherche « client » (mot présent partout), 500 résultats" "SELECT \"entiteId\" FROM \"CptMot\" WHERE \"entite\" = 'CONTRAT' AND mot LIKE 'client%' LIMIT 500"
mesurer "recherche « pol00001234 » (une police)" "SELECT \"entiteId\" FROM \"CptMot\" WHERE \"entite\" = 'CONTRAT' AND mot LIKE 'pol00001234%' LIMIT 500"
mesurer "contrats trouvés, 50 plus récents (id parmi 500)" "SELECT * FROM \"CptContrat\" WHERE id IN (SELECT \"entiteId\" FROM \"CptMot\" WHERE \"entite\" = 'CONTRAT' AND mot LIKE 'courtier7%' LIMIT 500) ORDER BY \"creeAt\" DESC, \"numPolice\" ASC LIMIT 50"
mesurer "échéances d'un contrat" "SELECT * FROM \"CptEcheance\" WHERE \"contratId\" = 'k-4242' ORDER BY rang"
mesurer "échéances en retard (état + date prévue)" "SELECT count(*) FROM \"CptEcheance\" WHERE etat = 'OUVERTE' AND \"datePrevue\" < current_date"

[ "$KO" -eq 0 ] && echo "GC-3g : toutes les requêtes de l'écran Production sous ${SEUIL_MS} ms sur $N contrats." || { echo "GC-3g : au moins une requête dépasse ${SEUIL_MS} ms."; exit 1; }
