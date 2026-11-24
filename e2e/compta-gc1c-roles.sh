#!/usr/bin/env bash
# Gestion Compta, lot GC-1c : vérifie module, permissions, rôles de départ, attribution au DG superviseur et seed sur une base
# PostgreSQL 16 JETABLE (conteneur créé puis supprimé ici, jamais la base de développement).
#   1. migrations depuis zéro, `migrate diff` vide ;
#   2. module, 18 + 1 permissions, 5 rôles et leurs 27 attributions ;
#   3. rejeu de la migration sur une base « existante » (rôle DG, rôle Finance) : le DG reçoit exactement 3 permissions, par
#      permission sœur, aucun autre rôle n'est touché, le rejeu est sans effet ;
#   4. seed : comptes de test, DG superviseur, paramètres, rejeu, absence de comptes en production, refus si mise en service.
# Usage : bash e2e/compta-gc1c-roles.sh      (Docker requis ; port COMPTA_PG_PORT, 55497 par défaut)
set -euo pipefail
cd "$(dirname "$0")/.."

NOM="pg-compta-gc1c"
PORT="${COMPTA_PG_PORT:-55497}"
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
psql_cpt() { docker exec -i "$NOM" psql -U postgres -d compta -v ON_ERROR_STOP=1 -q -t -A "$@"; }
verifier() { # verifier "libellé" "valeur attendue" "requête"
  local obtenu; obtenu="$(psql_cpt -c "$3")"
  [ "$obtenu" = "$2" ] || { echo "KO : $1 (attendu $2, obtenu $obtenu)"; exit 1; }
  echo "OK $1"
}
MIGRATION="backend/prisma/migrations/20261101110000_compta_permissions_roles/migration.sql"

echo "== 1. Migrations depuis zéro =="
(cd backend && npx prisma migrate deploy --config prisma7.config.ts 2>&1 | grep -E "compta_permissions_roles|successfully applied|rror")
(cd backend && npx prisma migrate diff --config prisma7.config.ts --from-config-datasource --to-schema prisma/schema.prisma --exit-code 2>&1 | grep -E "No difference|rror|difference") \
  || { echo "KO : écart détecté entre schema.prisma et la base"; exit 1; }

echo "== 2. Module, permissions, rôles =="
verifier "module compta créé et actif" "t" "SELECT \"isActive\" FROM \"Module\" WHERE key = 'compta'"
verifier "18 permissions dans le module compta" "18" "SELECT count(*) FROM \"Permission\" p JOIN \"Module\" m ON m.id = p.\"moduleId\" WHERE m.key = 'compta'"
verifier "cpt.mettre_en_service dans le module technique systeme" "systeme" "SELECT m.key FROM \"Permission\" p JOIN \"Module\" m ON m.id = p.\"moduleId\" WHERE p.key = 'cpt.mettre_en_service'"
verifier "5 rôles « Compta – »" "5" "SELECT count(*) FROM \"Role\" WHERE name LIKE 'Compta – %'"
verifier "aucun rôle Compta n'est admin ni bénéficiaire de délégation" "0" "SELECT count(*) FROM \"Role\" WHERE name LIKE 'Compta – %' AND (\"estAdmin\" OR \"peutEtreBeneficiaireDelegation\")"
verifier "27 attributions rôle-permission pour les rôles Compta" "27" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name LIKE 'Compta – %'"
verifier "RFCRH : 13 permissions" "13" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name = 'Compta – RFCRH'"
verifier "RFCRH ne peut pas confirmer un rattachement (étape 1)" "0" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE r.name = 'Compta – RFCRH' AND p.key = 'cpt.confirmer_rattachement'"
verifier "Direction : consulter + trancher_litige seulement" "cpt.consulter,cpt.trancher_litige" "SELECT string_agg(p.key, ',' ORDER BY p.key) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE r.name = 'Compta – Direction'"
verifier "mise en service dans aucun rôle Compta" "0" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE r.name LIKE 'Compta – %' AND p.key = 'cpt.mettre_en_service'"

echo "== 3. Rejeu sur une base « existante » : le DG superviseur, par permission sœur =="
# État de production simulé : un rôle DG (porte la permission sœur systeme.reinitialiser) et un rôle Finance (ne la porte pas).
psql_cpt -c "INSERT INTO \"Role\" (id, name, description) VALUES ('r-dg', 'DG', 'test'), ('r-fin', 'Finance', 'test'), ('r-autre', 'Directeur Général Adjoint', 'test') ON CONFLICT DO NOTHING" >/dev/null
psql_cpt -c "INSERT INTO \"RolePermission\" (\"roleId\", \"permissionId\") SELECT 'r-dg', id FROM \"Permission\" WHERE key = 'systeme.reinitialiser' ON CONFLICT DO NOTHING" >/dev/null
# Un rôle quelconque qui porte la permission sœur la reçoit aussi : preuve que la règle est la permission, pas le nom « DG ».
psql_cpt -c "INSERT INTO \"RolePermission\" (\"roleId\", \"permissionId\") SELECT 'r-autre', id FROM \"Permission\" WHERE key = 'systeme.reinitialiser' ON CONFLICT DO NOTHING" >/dev/null
AVANT="$(psql_cpt -c "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name NOT LIKE 'Compta – %' AND r.id NOT IN ('r-dg','r-autre')")"
psql_cpt < "$MIGRATION" >/dev/null
verifier "DG : exactement 3 permissions cpt" "cpt.consulter,cpt.mettre_en_service,cpt.trancher_litige" "SELECT string_agg(p.key, ',' ORDER BY p.key) FROM \"RolePermission\" rp JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE rp.\"roleId\" = 'r-dg' AND p.key LIKE 'cpt.%'"
verifier "règle par permission sœur : un autre rôle qui la porte la reçoit aussi" "3" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE rp.\"roleId\" = 'r-autre' AND p.key LIKE 'cpt.%'"
verifier "Finance (sans permission sœur) ne reçoit rien" "0" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE rp.\"roleId\" = 'r-fin' AND p.key LIKE 'cpt.%'"
verifier "aucun autre rôle existant n'est touché" "$AVANT" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name NOT LIKE 'Compta – %' AND r.id NOT IN ('r-dg','r-autre')"
verifier "rejeu : toujours 27 attributions Compta" "27" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name LIKE 'Compta – %'"
verifier "rejeu : toujours 19 permissions cpt et 5 rôles" "19/5" "SELECT (SELECT count(*) FROM \"Permission\" WHERE key LIKE 'cpt.%') || '/' || (SELECT count(*) FROM \"Role\" WHERE name LIKE 'Compta – %')"
psql_cpt -c "DELETE FROM \"RolePermission\" WHERE \"roleId\" IN ('r-dg','r-autre','r-fin')" >/dev/null
psql_cpt -c "DELETE FROM \"Role\" WHERE id IN ('r-dg','r-autre','r-fin')" >/dev/null

echo "== 4. Seed =="
(cd backend && npx tsx prisma/seed.ts >/dev/null 2>&1) || { echo "KO : le seed a échoué"; exit 1; }
verifier "seed : 5 comptes de test Compta" "5" "SELECT count(*) FROM \"User\" WHERE email LIKE 'compta-%@simassurances.test'"
verifier "seed : chaque compte a son rôle de départ" "5" "SELECT count(*) FROM \"User\" u JOIN \"Role\" r ON r.id = u.\"roleId\" WHERE u.email LIKE 'compta-%@simassurances.test' AND r.name LIKE 'Compta – %'"
verifier "seed : le rôle DG porte les 3 permissions superviseur" "cpt.consulter,cpt.mettre_en_service,cpt.trancher_litige" "SELECT string_agg(p.key, ',' ORDER BY p.key) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE r.name = 'DG' AND p.key LIKE 'cpt.%'"
verifier "seed : aucun autre rôle non Compta ne porte de permission cpt" "0" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" JOIN \"Permission\" p ON p.id = rp.\"permissionId\" WHERE p.key LIKE 'cpt.%' AND r.name NOT LIKE 'Compta – %' AND r.name <> 'DG'"
verifier "seed : 27 attributions pour les rôles Compta" "27" "SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name LIKE 'Compta – %'"
verifier "seed : 12 paramètres par défaut" "12" 'SELECT count(*) FROM "CptParametre"'
(cd backend && npx tsx prisma/seed.ts >/dev/null 2>&1) || { echo "KO : le seed rejoué a échoué"; exit 1; }
verifier "seed rejoué : toujours 5 comptes Compta, 12 paramètres, 27 attributions" "5/12/27" "SELECT (SELECT count(*) FROM \"User\" WHERE email LIKE 'compta-%@simassurances.test') || '/' || (SELECT count(*) FROM \"CptParametre\") || '/' || (SELECT count(*) FROM \"RolePermission\" rp JOIN \"Role\" r ON r.id = rp.\"roleId\" WHERE r.name LIKE 'Compta – %')"
(cd backend && NODE_ENV=production npx tsx prisma/seed.ts >/dev/null 2>&1) || { echo "KO : le seed en production a échoué"; exit 1; }
verifier "seed en production : aucun compte de test Compta" "0" "SELECT count(*) FROM \"User\" WHERE email LIKE 'compta-%@simassurances.test'"
verifier "seed en production : les rôles Compta existent quand même" "5" "SELECT count(*) FROM \"Role\" WHERE name LIKE 'Compta – %'"
# Mise en service : le seed doit refuser SANS rien supprimer.
(cd backend && npx tsx prisma/seed.ts >/dev/null 2>&1) || { echo "KO : le seed (retour hors production) a échoué"; exit 1; }
psql_cpt -c "INSERT INTO \"CptMiseEnService\" (\"activeeParId\", \"sauvegardeSha256\") SELECT id, 'sha-synthetique' FROM \"User\" WHERE email = 'dg@simassurances.test'" >/dev/null
UTILISATEURS="$(psql_cpt -c 'SELECT count(*) FROM "User"')"
if (cd backend && npx tsx prisma/seed.ts >/dev/null 2>&1); then echo "KO : le seed aurait dû refuser (module mis en service)"; exit 1; fi
echo "OK seed refusé quand le module est mis en service"
verifier "seed refusé : aucun compte supprimé" "$UTILISATEURS" 'SELECT count(*) FROM "User"'

echo "GC-1c : module, permissions, rôles, DG superviseur et seed vérifiés."
