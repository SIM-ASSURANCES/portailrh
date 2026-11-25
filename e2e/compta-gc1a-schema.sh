#!/usr/bin/env bash
# Gestion Compta, lot GC-1a : vérifie le schéma du socle sur une base PostgreSQL 16 JETABLE (conteneur créé puis supprimé ici,
# jamais la base de développement).
#   1. toutes les migrations s'appliquent depuis zéro ;
#   2. aucun écart entre schema.prisma et la base (`prisma migrate diff`) ;
#   3. contraintes et triggers du socle (e2e/compta-gc1a-triggers.sql).
# Usage : bash e2e/compta-gc1a-schema.sh      (Docker requis ; port COMPTA_PG_PORT, 55498 par défaut)
set -euo pipefail
cd "$(dirname "$0")/.."

NOM="pg-compta-gc1a"
PORT="${COMPTA_PG_PORT:-55498}"
nettoyer() { docker rm -f "$NOM" >/dev/null 2>&1 || true; }
trap nettoyer EXIT
nettoyer

docker run -d --rm --name "$NOM" -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=compta -p "$PORT":5432 postgres:16 >/dev/null
# L'image démarre un serveur temporaire puis le relance : attendre le SECOND "ready to accept connections".
for _ in $(seq 1 60); do
  [ "$(docker logs "$NOM" 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break
  sleep 1
done
sleep 1

export DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta?schema=public"

echo "== 1. Migrations depuis zéro =="
(cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_socle_technique|successfully applied|rror")

echo "== 2. Écart schéma / base (doit être nul) =="
(cd backend && npx prisma migrate diff --config prisma7.config.ts --from-config-datasource --to-schema prisma/schema.prisma --exit-code 2>&1 | grep -E "No difference|rror|difference") \
  || { echo "KO : écart détecté entre schema.prisma et la base"; exit 1; }

echo "== 3. Contraintes et triggers =="
docker exec -i "$NOM" psql -U postgres -d compta -v ON_ERROR_STOP=1 -q -t -A < e2e/compta-gc1a-triggers.sql

echo "== 4. Paramètres par défaut (GC-1b) =="
psql_cpt() { docker exec -i "$NOM" psql -U postgres -d compta -v ON_ERROR_STOP=1 -q -t -A "$@"; }
verifier() { # verifier "libellé" "valeur attendue" "requête"
  local obtenu; obtenu="$(psql_cpt -c "$3")"
  [ "$obtenu" = "$2" ] || { echo "KO : $1 (attendu $2, obtenu $obtenu)"; exit 1; }
  echo "OK $1"
}
verifier "12 paramètres posés par la migration" "12" 'SELECT count(*) FROM "CptParametre"'
verifier "jour limite de la taxe = 20" "20" "SELECT valeur FROM \"CptParametre\" WHERE cle = 'tca.jour_limite_paiement'"
# Une valeur modifiée n'est jamais écrasée par un rejeu de la migration (ON CONFLICT DO NOTHING) ; le rejeu est sans effet.
psql_cpt -c "UPDATE \"CptParametre\" SET valeur = '15' WHERE cle = 'tca.jour_limite_paiement'" >/dev/null
psql_cpt < backend/prisma/migrations/20261101100000_compta_parametres_defauts/migration.sql >/dev/null
verifier "rejeu : valeur modifiée conservée" "15" "SELECT valeur FROM \"CptParametre\" WHERE cle = 'tca.jour_limite_paiement'"
verifier "rejeu : toujours 12 paramètres" "12" 'SELECT count(*) FROM "CptParametre"'
refuse() { # refuse "libellé" "requête" : la requête doit échouer sur la contrainte de borne
  if psql_cpt -c "$2" >/dev/null 2>&1; then echo "KO : $1 aurait dû être refusé"; exit 1; fi
  echo "OK $1"
}
refuse "jour limite 0 refusé" "UPDATE \"CptParametre\" SET valeur = '0' WHERE cle = 'tca.jour_limite_paiement'"
refuse "jour limite 29 refusé" "UPDATE \"CptParametre\" SET valeur = '29' WHERE cle = 'tca.jour_limite_paiement'"
refuse "jour limite non numérique refusé" "UPDATE \"CptParametre\" SET valeur = 'vingt' WHERE cle = 'tca.jour_limite_paiement'"
psql_cpt -c "UPDATE \"CptParametre\" SET valeur = '28' WHERE cle = 'tca.jour_limite_paiement'" >/dev/null && echo "OK jour limite 28 accepté"
psql_cpt -c "UPDATE \"CptParametre\" SET valeur = 'abc' WHERE cle = 'relance.jours'" >/dev/null && echo "OK la borne ne vise que le jour limite (autre clé libre)"

echo "== 5. Tâches planifiées vides (GC-1e) =="
verifier "enum TacheNom : 7 valeurs (4 existantes + 3 Gestion Compta)" "7" \
  "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TacheNom'"
verifier "les trois valeurs COMPTA_* existent" "3" \
  "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TacheNom' AND e.enumlabel LIKE 'COMPTA\\_%'"
# Le rejeu de la migration est sans effet (ADD VALUE IF NOT EXISTS) : toujours 7 valeurs.
psql_cpt < backend/prisma/migrations/20261101120000_compta_taches_planifiees/migration.sql >/dev/null
verifier "rejeu de la migration : toujours 7 valeurs" "7" \
  "SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TacheNom'"
# Preuve que l'application pourra écrire ses lignes d'exécution (sinon le planificateur échouerait à chaque passage).
for t in COMPTA_CONTROLE_HEBDO COMPTA_RELANCES COMPTA_RAPPEL_TCA; do
  psql_cpt -c "INSERT INTO \"ExecutionTache\" (id, tache, declenchement, debut, fin, statut, bilan) VALUES ('e2e-$t', '$t', 'PLANIFICATEUR', now(), now(), 'SUCCES', '{\"traites\":0,\"erreurs\":0,\"enAttenteDuModule\":true}')" >/dev/null
  echo "OK ExecutionTache accepte $t"
done
verifier "3 exécutions Gestion Compta enregistrées" "3" "SELECT count(*) FROM \"ExecutionTache\" WHERE tache::text LIKE 'COMPTA\\_%'"
refuse "une valeur inconnue reste refusée par l'enum" "INSERT INTO \"ExecutionTache\" (id, tache, declenchement, debut, fin, statut) VALUES ('e2e-x', 'COMPTA_INCONNUE', 'PLANIFICATEUR', now(), now(), 'SUCCES')"

echo "== 6. Formats d'import (GC-1f) =="
COL='[{"entete":"Date","champ":"date","type":"date","obligatoire":true}]'
ajout_format() { # ajout_format type nom ligneEntete colonnes defaut
  psql_cpt -c "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"parDefaut\", \"majAt\") VALUES ('e2e-' || md5(random()::text), '$1', '$2', $3, '$4'::jsonb, $5, now())"
}
ajout_format RELEVE_WAVE_BUSINESS "Wave 2026" 1 "$COL" true >/dev/null && echo "OK un format valide est accepté"
verifier "la migration pose UN seul format (PRODUCTION par défaut, lot GC-3f) : avec celui de l'essai, il y en a 2" "2" 'SELECT count(*) FROM "CptFormatImport"'
verifier "le format posé par la migration est le PRODUCTION par défaut, actif" "1" "SELECT count(*) FROM \"CptFormatImport\" WHERE type = 'PRODUCTION' AND \"parDefaut\" AND actif"
refuse "même type et même nom refusés (unicité)" "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"majAt\") VALUES ('e2e-dup', 'RELEVE_WAVE_BUSINESS', 'Wave 2026', 1, '$COL'::jsonb, now())"
refuse "deux formats par défaut pour le même type refusés (index partiel)" \
  "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"parDefaut\", \"majAt\") VALUES ('e2e-def2', 'RELEVE_WAVE_BUSINESS', 'Wave bis', 1, '$COL'::jsonb, true, now())"
ajout_format RELEVE_WAVE_BUSINESS "Wave ancien" 1 "$COL" false >/dev/null && echo "OK un second format NON par défaut du même type est accepté"
ajout_format RELEVE_BANQUE "Banque 2026" 3 "$COL" true >/dev/null && echo "OK un format par défaut d'un AUTRE type est accepté"
refuse "ligne d'en-têtes 0 refusée" "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"majAt\") VALUES ('e2e-l0', 'PRODUCTION', 'L0', 0, '$COL'::jsonb, now())"
refuse "ligne d'en-têtes 51 refusée" "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"majAt\") VALUES ('e2e-l51', 'PRODUCTION', 'L51', 51, '$COL'::jsonb, now())"
refuse "colonnes vides ([]) refusées" "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"majAt\") VALUES ('e2e-vide', 'PRODUCTION', 'Vide', 1, '[]'::jsonb, now())"
refuse "colonnes qui ne sont pas un tableau refusées" "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"majAt\") VALUES ('e2e-obj', 'PRODUCTION', 'Objet', 1, '{\"a\":1}'::jsonb, now())"
refuse "type d'import inconnu refusé par l'enum" "INSERT INTO \"CptFormatImport\" (id, type, nom, \"ligneEntete\", colonnes, \"majAt\") VALUES ('e2e-typ', 'INCONNU', 'X', 1, '$COL'::jsonb, now())"
# Le rejeu de la migration échoue sur CREATE TABLE (comme toute migration de création) : elle n'est jamais rejouée, `_prisma_migrations` l'empêche.

echo "== 7. Référentiels (GC-2a), sur une base FRAÎCHE =="
# Base séparée : le module y est mis « en service » en cours de test, ce qui ne se défait pas, et l'on veut aussi prouver
# qu'une suppression est acceptée AVANT cette mise en service.
psql_cpt -d postgres -c 'CREATE DATABASE compta_ref' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_ref?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_referentiels|successfully applied|rror"')
docker exec -i "$NOM" psql -U postgres -d compta_ref -v ON_ERROR_STOP=1 -q -t -A < e2e/compta-gc2a-referentiels.sql

echo "== 8. Index de recherche par mots (GC-2d) =="
verifier "la colonne mot est en collation C (sert un LIKE 'x%')" "C" \
  "SELECT collation_name FROM information_schema.columns WHERE table_name = 'CptMot' AND column_name = 'mot'"
verifier "la migration ne pose aucun mot sur une base vide" "0" 'SELECT count(*) FROM "CptMot"'
# Fiches d'essai, insérées APRÈS la migration : on rejoue ensuite le seul remplissage (idempotent) comme sur une base déjà peuplée.
psql_cpt -c "INSERT INTO \"CptPartenaire\" (id, nom, \"estApporteur\", coordonnees, \"tiersOdoo\", \"majAt\") VALUES ('p-alpha', 'Courtier Alpha', true, 'Plateau, Abidjan', 'T-ALPHA', now()), ('p-beta', 'Bénéficiaire Beta', false, NULL, NULL, now())" >/dev/null
psql_cpt -c "INSERT INTO \"CptClient\" (id, nom, telephone, \"pieceIdentite\", \"partenaireOrigineId\", \"tiersOdoo\", \"majAt\") VALUES ('c-aya', 'Aya N''Guessan', '+2250700000001', 'CNI-123', 'p-alpha', 'T-9', now()), ('c-aissatou', 'Aïssatou Koné', NULL, NULL, NULL, NULL, now())" >/dev/null
psql_cpt -c "INSERT INTO \"CptProduit\" (id, code, libelle, branche, \"compteOdoo\", \"majAt\") VALUES ('x-secur', 'SECUR-PRO', 'Sécurité Pro', 'DECES', '411100', now()), ('x-sante', 'SANTE-1', 'Santé 1', 'SANTE', NULL, now())" >/dev/null
sed -n '/^INSERT INTO "CptMot"/,$p' backend/prisma/migrations/20261101150000_compta_recherche_mots/migration.sql | psql_cpt >/dev/null
verifier "le remplissage indexe les trois types de fiches" "3" 'SELECT count(DISTINCT entite) FROM "CptMot"'
verifier "N'Guessan : jeton joint, partie, téléphone sans « + »" "3" \
  "SELECT count(*) FROM \"CptMot\" WHERE entite = 'CLIENT' AND \"entiteId\" = 'c-aya' AND mot IN ('nguessan', 'guessan', '2250700000001')"
verifier "le nom du partenaire d'origine fait partie des mots du client" "1" \
  "SELECT count(*) FROM \"CptMot\" WHERE entite = 'CLIENT' AND \"entiteId\" = 'c-aya' AND mot = 'courtier'"
verifier "la branche (accent retiré) fait partie des mots du produit" "1" \
  "SELECT count(*) FROM \"CptMot\" WHERE entite = 'PRODUIT' AND \"entiteId\" = 'x-secur' AND mot = 'deces'"
NB_AVANT="$(psql_cpt -c 'SELECT count(*) FROM "CptMot"')"
sed -n '/^INSERT INTO "CptMot"/,$p' backend/prisma/migrations/20261101150000_compta_recherche_mots/migration.sql | psql_cpt >/dev/null
verifier "rejeu du remplissage : aucun doublon, même nombre de mots" "$NB_AVANT" 'SELECT count(*) FROM "CptMot"'
# Le calcul TypeScript (utilisé par les écrans) et le remplissage SQL donnent EXACTEMENT les mêmes mots ; la recherche les retrouve.
# COMPTA_PERF=1 ajoute 150 000 clients synthétiques et chronomètre les recherches.
COMPTA_PG_CONTENEUR="$NOM" npx tsx e2e/compta-gc2d-mots.ts | tail -40

echo "== 9. Production (GC-3a), sur une base FRAÎCHE =="
# Base séparée : la mise en service du module, simulée par le script SQL, ne se défait pas.
psql_cpt -d postgres -c 'CREATE DATABASE compta_prod' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_prod?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_production|successfully applied|rror"')
docker exec -i "$NOM" psql -U postgres -d compta_prod -v ON_ERROR_STOP=1 -q -t -A < e2e/compta-gc3a-production.sql

echo "== 10. Import de production (GC-3c), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_imp' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_imp?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror"')
DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_imp?schema=public" npx tsx e2e/compta-gc3c-import.ts | tail -60

echo "== 11. Encaissements et relevés (GC-4a), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_enc' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_enc?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_encaissements|successfully applied|rror"')
docker exec -i "$NOM" psql -U postgres -d compta_enc -v ON_ERROR_STOP=1 -q -t -A < e2e/compta-gc4a-encaissements.sql
# Aucun écart entre la migration écrite à la main et schema.prisma (code de sortie 2 = écart).
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_enc?schema=public" bash -c 'cd backend && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config prisma7.config.ts >/dev/null 2>&1; code=$?; if [ $code -eq 0 ]; then echo "OK  migrate diff vide (schéma et migrations alignés)"; else echo "KO  migrate diff non vide (code $code)"; exit 1; fi')

echo "== 12. Import des relevés (GC-4d), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_rel' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rel?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror"')
DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rel?schema=public" COMPTA_PERF="${COMPTA_PERF:-}" npx tsx e2e/compta-gc4d-import.ts | tail -80

echo "== 13. Rattachements (GC-5b), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_rat' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rat?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_rattachements|successfully applied|rror"')
docker exec -i "$NOM" psql -U postgres -d compta_rat -v ON_ERROR_STOP=1 -q -t -A < e2e/compta-gc5b-rattachements.sql
# Aucun écart entre la migration écrite à la main et schema.prisma (code de sortie 2 = écart).
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rat?schema=public" bash -c 'cd backend && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config prisma7.config.ts >/dev/null 2>&1; code=$?; if [ $code -eq 0 ]; then echo "OK  migrate diff vide (schéma et migrations alignés)"; else echo "KO  migrate diff non vide (code $code)"; exit 1; fi')

echo "== 14. Rattachement en base (GC-5c), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_rat2' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rat2?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror"')
DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rat2?schema=public" npx tsx e2e/compta-gc5c-rattachements.ts | tail -60

echo "== 15. Relances 7 / 30 / 60 jours (GC-6b), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_rl6' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rl6?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror"')
DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_rl6?schema=public" npx tsx e2e/compta-gc6b-relances.ts | tail -60

echo "== 16. Taxe sur les contrats (GC-8a), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_tca' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_taxe|successfully applied|rror"')
docker exec -i "$NOM" psql -U postgres -d compta_tca -v ON_ERROR_STOP=1 -q -t -A < e2e/compta-gc8a-taxe.sql
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca?schema=public" bash -c 'cd backend && npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code --config prisma7.config.ts >/dev/null 2>&1; code=$?; if [ $code -eq 0 ]; then echo "OK  migrate diff vide (schéma et migrations alignés)"; else echo "KO  migrate diff non vide (code $code)"; exit 1; fi')
# Rejeu de la partie manuelle sans effet notable : la migration crée des tables, elle ne se rejoue pas (comme toutes les migrations de création) ;
# `migrate deploy` relancé ne réapplique rien.
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "No pending|rror"')

echo "== 17. Taxe en base (GC-8b), sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_tca2' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca2?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror"')
DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca2?schema=public" npx tsx e2e/compta-gc8b-taxe.ts | tail -40

echo "== 18. Rappels de la taxe (GC-8f), horloge simulée, sur une base FRAÎCHE =="
psql_cpt -d postgres -c 'CREATE DATABASE compta_tca3' >/dev/null
(DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca3?schema=public" bash -c 'cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "successfully applied|rror"')
DATABASE_URL="postgresql://postgres:pw@localhost:${PORT}/compta_tca3?schema=public" npx tsx e2e/compta-gc8f-rappel.ts | tail -30

echo "GC-1a, GC-1b, GC-1e, GC-1f, GC-2a, GC-2d, GC-3a, GC-3c, GC-4a, GC-4d, GC-5b, GC-5c, GC-6b, GC-8a, GC-8b et GC-8f : schéma, paramètres, tâches planifiées, formats d'import, référentiels, index de recherche, production, import de production, encaissements, import des relevés, rattachements et relances vérifiés."
