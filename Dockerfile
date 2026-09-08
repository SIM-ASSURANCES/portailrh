# syntax=docker/dockerfile:1

# ============================================================
# Image de base Debian, PAS Alpine.
#
# Alpine utilise musl libc, historiquement source de problèmes de
# compatibilité avec les binaires natifs de Prisma. Dans ce projet
# précisément, Prisma 7 est configuré avec le driver adapter
# `@prisma/adapter-pg` (voir CLAUDE.md, "Driver adapter @prisma/adapter-pg")
# : aucun moteur de requête binaire (`libquery_engine-*.so.node`) n'est
# généré ni utilisé au runtime — le client généré (`backend/src/generated/prisma`,
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
#
# Monorepo (voir CLAUDE.md "Monorepo backend/frontend") : deux packages npm
# (`backend/`, le schéma Prisma + la logique métier ; `frontend/`,
# l'application Next.js) déclarés comme workspaces npm depuis la racine —
# TOUJOURS UN SEUL conteneur applicatif final, comme avant : `backend` n'a
# pas de serveur propre, il est soit transpilé/inliné directement dans le
# build Next.js (`transpilePackages`, voir `frontend/next.config.ts`), soit
# invoqué en CLI (migrations/seed) depuis l'image finale.
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
# Copie uniquement les manifests d'abord (racine + chaque workspace) : le
# cache Docker de cette couche n'est invalidé que si l'un des trois
# package.json (ou le lockfile) change, pas à chaque changement de code
# source — npm a besoin des package.json de TOUS les workspaces pour
# résoudre le graphe de dépendances, même avant que leur code n'existe.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
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
# Le client Prisma généré (backend/src/generated/prisma) est exclu de
# l'image via .dockerignore (comme du dépôt via .gitignore) : régénéré ici
# à partir du schema, jamais copié depuis la machine hôte — évite tout
# binaire ou code généré pour la mauvaise plateforme.
RUN npm run generate
# DATABASE_URL factice : `next build` ne se connecte pas à la base (aucune
# page ne fait de requête Prisma au moment du build, tout est dynamique),
# mais `backend/prisma7.config.ts` lit `process.env.DATABASE_URL` au
# chargement du module — une valeur de forme valide évite un avertissement
# superflu. AUTH_SECRET : NextAuth vérifie sa présence dès le chargement du
# module (voir `frontend/src/lib/auth.config.ts`), même au moment du build
# (tracé par le compilateur) — nécessaire ici pour la même raison.
ENV DATABASE_URL="postgresql://user:password@localhost:5432/db"
ENV AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
# Le ".env" racine est exclu de l'image via .dockerignore (jamais de secret
# figé dans une couche) : `frontend/package.json`'s `prebuild` tente de le
# copier mais échoue silencieusement ici (fichier absent), sans faire
# planter le build — les deux `ENV` ci-dessus suffisent alors à eux seuls
# pour que `next build` passe la vérification `assertConfig` de NextAuth.
# Les vraies valeurs de production sont, elles, injectées au DÉMARRAGE du
# conteneur par docker-compose.yml (variable d'environnement réelle, jamais
# un fichier), bien après la fin de ce build.
RUN npm run build

# ---------- Stage 3 : prod-deps (dépendances de production uniquement) ----------
# Installation séparée et propre (npm ci --omit=dev) plutôt qu'une copie
# sélective de sous-dossiers de node_modules : le build "standalone" de
# Next.js ne trace que les modules réellement importés par le serveur
# Next.js lui-même, jamais la CLI Prisma (invoquée séparément par
# docker-entrypoint.sh) ni tsx (nécessaire pour lancer le seed
# manuellement, voir DEPLOIEMENT.md). `prisma`, `tsx` et `dotenv` sont dans
# les "dependencies" de `backend/package.json` (pas devDependencies)
# précisément pour qu'un `npm ci --omit=dev` à la racine les inclue.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
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

# Build standalone : serveur Next.js minimal + node_modules tracés. Le
# traçage d'un monorepo npm workspaces imbrique la sortie sous le chemin
# réel du package Next.js (`frontend/.next/standalone/frontend/...`,
# vérifié explicitement) plutôt que de la mettre directement à la racine
# de `standalone/` comme pour un projet single-package — d'où le chemin
# source `.../standalone/frontend` ci-dessous, à la place de
# `.../standalone` tel quel dans l'ancienne version mono-package de ce
# Dockerfile. `backend/` n'apparaît PAS séparément dans ce traçage : son
# code est directement inliné dans les chunks compilés du serveur Next.js
# (`transpilePackages`, vérifié explicitement en y retrouvant une fonction
# de `backend/src/tresorerie.ts`) — seuls son schéma Prisma et sa config
# (jamais du code applicatif) doivent encore être copiés séparément
# ci-dessous, pour les migrations/le seed exécutés en CLI.
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone/frontend ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./.next/static

# node_modules de production complet, fusionné par-dessus celui du build
# standalone : couvre la CLI Prisma (migrate deploy, db seed) et tsx,
# absents du traçage automatique de Next.js.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Fichiers nécessaires aux migrations et au seed manuel — pas du code
# serveur Next.js, donc pas copiés par le build standalone. Placés sous
# `./backend/` (chemin réel du package), `docker-entrypoint.sh` s'y déplace
# pour invoquer Prisma (voir ce fichier).
COPY --from=builder --chown=nextjs:nodejs /app/backend/prisma ./backend/prisma
COPY --from=builder --chown=nextjs:nodejs /app/backend/prisma7.config.ts ./backend/prisma7.config.ts

# Polices du reçu PDF (frontend/src/lib/pdf/fonts/*.ttf), lues au runtime
# via `readFileSync(path.join(process.cwd(), "src/lib/pdf/fonts", ...))` —
# pas un import JS. `src/lib/pdf/` reste dans `frontend/` (jamais déplacé
# vers `backend/`, voir CLAUDE.md "Monorepo backend/frontend" pour le
# raisonnement : son chargement de police dépend de `process.cwd()` ==
# racine de l'app Next.js elle-même). Vérifié que le traçage automatique de
# Next.js les inclut déjà dans .next/standalone/frontend/src/lib/pdf/fonts,
# mais cette copie explicite est ajoutée par robustesse : ce comportement
# du traceur n'est pas garanti contractuellement, et un échec silencieux
# ici (ENOENT) ne se manifesterait qu'au moment de télécharger un reçu, pas
# au démarrage.
COPY --from=builder --chown=nextjs:nodejs /app/frontend/src/lib/pdf/fonts ./src/lib/pdf/fonts

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Répertoire de stockage des futures pièces jointes (Demande/RetourCaisse —
# voir prisma/schema.prisma modèle PieceJointe, fonctionnalité pas encore
# implémentée). Créé et possédé par l'utilisateur applicatif AVANT le
# premier montage du volume nommé correspondant (docker-compose.yml,
# volume "uploads") : Docker respecte les permissions déjà en place dans
# l'image lors du tout premier montage d'un volume nommé vide, donc sans
# cette étape le volume serait possédé par root et inutilisable par le
# process non-root "nextjs". Chemin inchangé (`/app/uploads`, `process.cwd()`
# du serveur Next.js reste `/app` dans ce conteneur).
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads

USER nextjs

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
