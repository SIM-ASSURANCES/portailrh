# sim-portail

Portail interne modulaire SIM Assurances (Next.js 16 + Prisma 7). Voir
[CLAUDE.md](CLAUDE.md) pour la documentation complète (architecture,
règles métier, historique des tickets/phases) et
[DEPLOIEMENT.md](DEPLOIEMENT.md) pour le déploiement Docker.

## Structure du dépôt (monorepo)

Le projet est organisé en deux packages npm (workspaces), déclarés depuis
la racine — voir CLAUDE.md, section "Monorepo backend/frontend" pour le
détail complet et le raisonnement derrière chaque choix :

- **`backend/`** — schéma Prisma (`prisma/`) et logique métier pure
  (calculs financiers, permissions, reporting, validation), sans
  dépendance à Next.js.
- **`frontend/`** — l'application Next.js elle-même (pages, Server
  Actions, routes API, composants), qui importe `backend` comme une
  dépendance npm classique (`import { ... } from "backend"`).

## Démarrer en développement

```bash
npm install                # installe les deux workspaces depuis la racine
npm run generate            # génère le client Prisma (backend/src/generated)
npm run migrate             # applique les migrations sur la base locale
npm run seed                # peuple la base (rôles, permissions, comptes de test)
npm run dev                 # démarre le serveur Next.js (frontend), port 3000
```

Prérequis : un fichier `.env` **à la racine du dépôt** (partagé par
Prisma, Next.js et Docker Compose — voir `.env.example`) avec au minimum
`DATABASE_URL` (PostgreSQL) et `AUTH_SECRET`.

Comptes de test (mot de passe `password123` pour tous) :
`collaborateur@simassurances.test`, `finance@simassurances.test`,
`dg@simassurances.test`, `admin@simassurances.test`,
`rh@simassurances.test`.

## Autres commandes utiles

```bash
npm run build                # build de production (frontend)
npm run start                 # démarre le serveur de production (après build)
npm run lint                   # eslint sur les deux workspaces
npm run migrate:deploy          # migrations en mode non-interactif (CI/CD, Docker)
```

Chaque commande peut aussi être lancée dans un seul workspace via
`npm run <script> --workspace=backend` (ou `frontend`), ou directement
depuis son dossier (`cd backend && npx prisma studio`, par exemple).

## Déploiement

Voir [DEPLOIEMENT.md](DEPLOIEMENT.md) — le projet reste livré comme **une
seule image Docker** (un seul conteneur applicatif), quelle que soit
l'organisation interne du code en deux packages.
