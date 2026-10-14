#!/usr/bin/env bash
# Arrête le serveur du port donné (3100 par défaut) SANS toucher à la base, puis le relance avec la même configuration que
# base-jetable.sh. Variables d'environnement transmises telles quelles (PLANIFICATEUR_ACTIF, SMTP_*, NODE_ENV…).
# Usage : bash e2e/redemarrer-serveur.sh [port]
cd "$(dirname "$0")/../frontend"
PORT="${1:-3100}"
PID=$(netstat -ano 2>/dev/null | grep ":$PORT " | grep LISTEN | awk '{print $5}' | head -1)
[ -n "$PID" ] && (taskkill //PID "$PID" //T //F >/dev/null 2>&1 || kill "$PID" 2>/dev/null)
sleep 2
export DATABASE_URL="${E2E_DATABASE_URL:-postgresql://postgres:pw@localhost:55497/e2e}?schema=public"
(AUTH_URL="http://localhost:$PORT" ALLOWED_OFFICE_IPS="10.9.9.9,127.0.0.1,::1" CRON_SECRET="secret-e2e" \
  npx next start -p "$PORT" > /dev/null 2>&1 &)
for i in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done
echo "Serveur relancé sur http://localhost:$PORT."
