#!/usr/bin/env bash
# Base PostgreSQL jetable (conteneur supprimé à l'arrêt), migrations + seed, serveur de production sur le port 3100.
set -e
cd "$(dirname "$0")/.."
bash e2e/arreter.sh >/dev/null 2>&1 || true
docker run -d --rm --name pg-e2e -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=e2e -p ${E2E_PG_PORT:-55497}:5432 postgres:16 >/dev/null
# L'image démarre un serveur temporaire puis le relance : attendre le SECOND "ready to accept connections" (sinon le seed échoue).
for i in $(seq 1 60); do [ "$(docker logs pg-e2e 2>&1 | grep -c "ready to accept connections")" -ge 2 ] && break; sleep 1; done
sleep 1
export DATABASE_URL="postgresql://postgres:pw@localhost:${E2E_PG_PORT:-55497}/e2e?schema=public"
(cd backend && npx prisma migrate deploy --config prisma7.config.ts | tail -1 && npx tsx prisma/seed.ts | grep -iE "erreur|utilisateurs créés")
cd frontend
(AUTH_URL="http://localhost:3100" ALLOWED_OFFICE_IPS="10.9.9.9,127.0.0.1,::1" CRON_SECRET="secret-e2e" DATABASE_URL="$DATABASE_URL" \
  npx next start -p 3100 > /dev/null 2>&1 &)
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3100/login && break; sleep 1; done
echo "Serveur prêt sur http://localhost:3100 (base jetable pg-e2e)."
