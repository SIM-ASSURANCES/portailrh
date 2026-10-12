#!/usr/bin/env bash
# Arrête le serveur du port 3100 (tuer la tâche qui l'a lancé ne suffit pas) et le conteneur jetable.
PID=$(netstat -ano 2>/dev/null | grep ":3100 " | grep LISTEN | awk '{print $5}' | head -1)
[ -n "$PID" ] && (taskkill //PID "$PID" //T //F >/dev/null 2>&1 || kill "$PID" 2>/dev/null)
docker stop pg-e2e >/dev/null 2>&1
echo "Serveur et base jetable arrêtés."
