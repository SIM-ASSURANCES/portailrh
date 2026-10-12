#!/usr/bin/env bash
# Base PostgreSQL jetable (conteneur supprimé à l'arrêt), migrations + seed, serveur de production sur le port 3100.
set -e
cd "$(dirname "$0")/.."
bash e2e/arreter.sh >/dev/null 2>&1 || true
docker run -d --rm --name pg-e2e -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=e2e -p 55497:5432 postgres:16 >/dev/null
for i in $(seq 1 40); do docker exec pg-e2e pg_isready -U postgres -d e2e >/dev/null 2>&1 && break; sleep 1; done
sleep 2
export DATABASE_URL="postgresql://postgres:pw@localhost:55497/e2e?schema=public"
(cd backend && npx prisma migrate deploy --config prisma7.config.ts | tail -1 && npx tsx prisma/seed.ts | grep -iE "erreur|utilisateurs créés")
cd frontend
(AUTH_URL="http://localhost:3100" ALLOWED_OFFICE_IPS="10.9.9.9,127.0.0.1,::1" CRON_SECRET="secret-e2e" DATABASE_URL="$DATABASE_URL" \
  npx next start -p 3100 > /dev/null 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3100/login && break; sleep 1; done
echo "Serveur prêt sur http://localhost:3100 (base jetable pg-e2e)."
