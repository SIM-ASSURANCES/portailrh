# syntax=docker/dockerfile:1

# ============================================================
# Image de base Debian, PAS Alpine.
#
# Alpine utilise musl libc, historiquement source de problèmes de
# compatibilité avec les binaires natifs de Prisma. Dans ce projet
# précisément, Prisma 7 est configuré avec le driver adapter
# `@prisma/adapter-pg` (voir CLAUDE.md, "Driver adapter @prisma/adapter-pg")
# : aucun moteur de requête binaire (`libquery_engine-*.so.node`) n'est
# généré ni utilisé au runtime — le client généré (`src/generated/prisma`,
# vérifié : uniquement du TypeScript, aucun fichier binaire) passe
# entièrement par le driver JS `pg`. Le seul binaire natif Prisma restant
# est le "schema engine", utilisé UNIQUEMENT par les commandes CLI
# (`prisma generate`, `prisma migrate deploy`) — jamais par le serveur
# Next.js lui-même. Puisque `npm ci`/`prisma generate`/`prisma migrate
# deploy` s'exécutent tous DANS ce Dockerfile (donc dans l'environnement
# Linux/Debian cible, jamais sur la machine hôte Windows), le binaire
# schema-engine correct est automatiquement téléchargé pour cette
# plateforme sans configuration `binaryTargets` supplémentaire dans
# schema.prisma. Debian reste néanmoins le choix retenu (comme demandé) :
# c'est le socle le plus sûr et le plus standard pour un déploiement
# Node.js, y compris pour d'éventuels futurs besoins natifs (l'app dépend
# déjà de bibliothèques avec du binding natif indirect, ex: bcryptjs — pur
# JS ici, mais la prudence reste de mise).
# ============================================================

ARG NODE_IMAGE=node:20-bookworm-slim

# ---------- Stage 1 : deps (installation complète, pour le build) ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# openssl + ca-certificates : requis par les binaires Prisma (schema engine)
# et par tout appel HTTPS sortant (aucun en usage normal ici, mais anodin).
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Copie uniquement les manifests d'abord : le cache Docker de cette couche
# n'est invalidé que si les dépendances changent, pas à chaque changement
# de code source.
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 2 : builder ----------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Le client Prisma généré (src/generated/prisma) est exclu de l'image via
# .dockerignore (comme du dépôt via .gitignore) : régénéré ici à partir du
# schema, jamais copié depuis la machine hôte — évite tout binaire ou code
# généré pour la mauvaise plateforme.
RUN npx prisma generate
# DATABASE_URL factice : `next build` ne se connecte pas à la base (aucune
# page ne fait de requête Prisma au moment du build, tout est dynamique),
# mais `prisma7.config.ts` lit `process.env.DATABASE_URL` au chargement du
# module — une valeur de forme valide évite un avertissement superflu.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
RUN npm run build

# ---------- Stage 3 : prod-deps (dépendances de production uniquement) ----------
# Installation séparée et propre (npm ci --omit=dev) plutôt qu'une copie
# sélective de sous-dossiers de node_modules : le build "standalone" de
# Next.js ne trace que les modules réellement importés par le serveur
# Next.js lui-même, jamais la CLI Prisma (invoquée séparément par
# docker-entrypoint.sh) ni tsx (nécessaire pour lancer le seed
# manuellement, voir Tâche 3/DEPLOIEMENT.md). `prisma`, `tsx` et `dotenv`
# ont été déplacés vers "dependencies" dans package.json précisément pour
# qu'un `npm ci --omit=dev` les inclue.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- Stage 4 : runner (image finale) ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 --ingroup nodejs nextjs

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Build standalone : serveur Next.js minimal + node_modules tracés.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# node_modules de production complet, fusionné par-dessus celui du build
# standalone : couvre la CLI Prisma (migrate deploy, db seed) et tsx,
# absents du traçage automatique de Next.js.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Fichiers nécessaires aux migrations et au seed manuel — pas du code
# serveur Next.js, donc pas copiés par le build standalone.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma7.config.ts ./prisma7.config.ts

# Polices du reçu PDF (src/lib/pdf/fonts/*.ttf), lues au runtime via
# `readFileSync(path.join(process.cwd(), "src/lib/pdf/fonts", ...))` — pas
# un import JS. Vérifié que le traçage automatique de Next.js les inclut
# déjà dans .next/standalone/src/lib/pdf/fonts, mais cette copie explicite
# est ajoutée par robustesse : ce comportement du traceur n'est pas
# garanti contractuellement, et un échec silencieux ici (ENOENT) ne se
# manifesterait qu'au moment de télécharger un reçu, pas au démarrage.
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/pdf/fonts ./src/lib/pdf/fonts

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Répertoire de stockage des futures pièces jointes (Demande/RetourCaisse —
# voir prisma/schema.prisma modèle PieceJointe, fonctionnalité pas encore
# implémentée). Créé et possédé par l'utilisateur applicatif AVANT le
# premier montage du volume nommé correspondant (docker-compose.yml,
# volume "uploads") : Docker respecte les permissions déjà en place dans
# l'image lors du tout premier montage d'un volume nommé vide, donc sans
# cette étape le volume serait possédé par root et inutilisable par le
# process non-root "nextjs".
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
