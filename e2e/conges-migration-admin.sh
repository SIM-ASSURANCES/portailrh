#!/usr/bin/env bash
# Congés — A2 (relecture du 2026-10-16) : la migration des droits congés/absences n'en donne AUCUN à un rôle `estAdmin`,
# même quand ce rôle porte les permissions « sœurs » (anomalie des 23 permissions de l'Admin en base de dev).
# Base jetable créée dans le conteneur pg-e2e (voir base-jetable.sh) ; les fichiers de migration sont rejoués dans l'ordre
# avec psql (sans Prisma), la migration testée est appliquée DEUX fois.
set -e
cd "$(dirname "$0")/.."
DBN=mig_a2
PSQL="docker exec -i -e PGOPTIONS=-cclient_min_messages=warning pg-e2e psql -U postgres -v ON_ERROR_STOP=1 -q -t -A"
MIGS=backend/prisma/migrations
CIBLE=20261021090000_conges_permissions_absence

docker exec pg-e2e psql -U postgres -q -c "DROP DATABASE IF EXISTS $DBN" -c "CREATE DATABASE $DBN" >/dev/null
for d in $(ls "$MIGS" | grep -E '^[0-9]{14}_' | sort); do
  [ "$d" = "$CIBLE" ] && break
  $PSQL -d $DBN < "$MIGS/$d/migration.sql" >/dev/null
done

# Fixtures qui imitent la production : le seed crée les permissions pointage.* (aucune migration ne le fait), l'Admin les porte.
$PSQL -d $DBN >/dev/null <<'SQL'
INSERT INTO "Module" (id, key, label) VALUES ('m-pointage', 'pointage', 'Pointage RH') ON CONFLICT (key) DO NOTHING;
INSERT INTO "Permission" (id, key, label, "moduleId")
SELECT 'p-' || v.k, v.k, v.k, m.id FROM (VALUES
  ('pointage.pointer'), ('pointage.corriger_pointage'), ('pointage.consulter_tous'),
  ('pointage.voir_dashboard_rh'), ('pointage.voir_reporting')
) AS v(k) JOIN "Module" m ON m.key = 'pointage' ON CONFLICT (key) DO NOTHING;
INSERT INTO "Permission" (id, key, label, "moduleId")
SELECT 'p-' || v.k, v.k, v.k, m.id FROM (VALUES ('treso.creer_demande'), ('treso.decider_dg')) AS v(k)
JOIN "Module" m ON m.key = 'tresorerie' ON CONFLICT (key) DO NOTHING;

INSERT INTO "Role" (id, name, "estAdmin") VALUES
  ('r-admin', 'Admin', true), ('r-rh', 'RH', false), ('r-dg', 'DG', false),
  ('r-collab', 'Collaborateur', false), ('r-fin', 'Finance', false), ('r-asst', 'Assistant Finance', false)
ON CONFLICT (name) DO NOTHING;
-- Les migrations antérieures créent déjà certains rôles (ex. Assistant Finance) : on repart des identifiants réels.
CREATE TEMP TABLE r AS SELECT name, id FROM "Role";
UPDATE "Role" SET "estAdmin" = (name = 'Admin') WHERE name IN ('Admin','RH','DG','Collaborateur','Finance','Assistant Finance');
-- Rôles de départ des migrations : on vide leurs permissions pour ne tester que les fixtures ci-dessous.
DELETE FROM "RolePermission" WHERE "roleId" IN (SELECT id FROM r WHERE name IN ('Admin','RH','DG','Collaborateur','Finance','Assistant Finance'));

-- Admin : porte TOUTES les permissions sœurs (cas de la base de dev).
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT (SELECT id FROM r WHERE name = 'Admin'), id FROM "Permission" WHERE key LIKE 'pointage.%' OR key IN ('treso.creer_demande', 'treso.decider_dg');
INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT (SELECT id FROM r WHERE name = 'RH'), id FROM "Permission" WHERE key LIKE 'pointage.%';
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT (SELECT id FROM r WHERE name = 'DG'), id FROM "Permission" WHERE key = 'treso.decider_dg';
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT (SELECT id FROM r WHERE name = 'Collaborateur'), id FROM "Permission" WHERE key = 'pointage.pointer';
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT (SELECT id FROM r WHERE name = 'Finance'), id FROM "Permission" WHERE key = 'treso.creer_demande';
INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT (SELECT id FROM r WHERE name = 'Assistant Finance'), id FROM "Permission" WHERE key = 'treso.creer_demande';
SQL

$PSQL -d $DBN < "$MIGS/$CIBLE/migration.sql" >/dev/null

# Permissions congés/absences d'un rôle (clés triées, séparées par des virgules).
cles() { $PSQL -d $DBN -c "SELECT coalesce(string_agg(p.key, ',' ORDER BY p.key), '') FROM \"RolePermission\" rp JOIN \"Permission\" p ON p.id = rp.\"permissionId\" JOIN \"Role\" ro ON ro.id = rp.\"roleId\" WHERE ro.name = '$1' AND (p.key LIKE 'conges.%' OR p.key LIKE 'absences.%')"; }
RES=0
verifier() { if [ "$2" = "$3" ]; then echo "OK  $1"; else echo "KO  $1 — attendu « $3 », obtenu « $2 »"; RES=1; fi; }

verifier "Admin (estAdmin) : soumettre seulement, aucun droit RH ni de gestion" "$(cles Admin)" "absences.soumettre,conges.soumettre"
verifier "RH : toutes les permissions RH" "$(cles RH)" "absences.annuler,absences.consulter_tous,absences.parametrer,absences.soumettre,absences.valider_rh,conges.annuler,conges.consulter_tous,conges.gerer_soldes,conges.parametrer_types,conges.soumettre,conges.valider_rh"
verifier "DG : soumettre seulement" "$(cles DG)" "absences.soumettre,conges.soumettre"
verifier "Collaborateur : soumettre seulement" "$(cles Collaborateur)" "absences.soumettre,conges.soumettre"
verifier "Finance : soumettre seulement" "$(cles Finance)" "absences.soumettre,conges.soumettre"
verifier "Assistant Finance : soumettre seulement" "$(cles "Assistant Finance")" "absences.soumettre,conges.soumettre"

AVANT=$($PSQL -d $DBN -c 'SELECT count(*) FROM "RolePermission"')
$PSQL -d $DBN < "$MIGS/$CIBLE/migration.sql" >/dev/null
APRES=$($PSQL -d $DBN -c 'SELECT count(*) FROM "RolePermission"')
verifier "Second passage de la migration : aucun effet" "$APRES" "$AVANT"
verifier "Après le second passage, l'Admin n'a toujours que soumettre" "$(cles Admin)" "absences.soumettre,conges.soumettre"

docker exec pg-e2e psql -U postgres -q -c "DROP DATABASE $DBN" >/dev/null
exit $RES
