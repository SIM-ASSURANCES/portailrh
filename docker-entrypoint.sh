#!/bin/sh
# Script de démarrage du conteneur "app" (Ticket Docker, Tâche 3).
#
# Applique les migrations Prisma en attente AVANT de démarrer le serveur
# Next.js, avec `migrate deploy` — jamais `migrate dev`, qui est pensé pour
# le développement local (peut poser des questions interactives, régénérer
# des migrations) et n'est pas fait pour tourner sans supervision au
# démarrage d'un conteneur de production.
#
# Le seed (`prisma/seed.ts`) n'est délibérément PAS exécuté ici : son
# script fait des `deleteMany()` avant de recréer les données de
# référence — l'exécuter à chaque démarrage/redémarrage du conteneur
# effacerait les vraies données de l'application. Voir DEPLOIEMENT.md pour
# la commande à lancer manuellement, une seule fois, à l'initialisation :
#   docker compose exec app npx prisma db seed

set -e

echo "==> Application des migrations Prisma (prisma migrate deploy)..."
npx prisma migrate deploy

echo "==> Migrations à jour. Démarrage du serveur..."
exec "$@"
