<!-- title: Déploiement Docker -->

# Déploiement de sim-portail avec Docker

Ce guide décrit comment construire et démarrer sim-portail entièrement
conteneurisé (application Next.js + PostgreSQL), sur n'importe quelle
machine disposant de Docker — pas de dépendance à un environnement
Windows/local spécifique.

## Prérequis

- [Docker](https://docs.docker.com/get-docker/) installé.
- Docker Compose v2 (intégré à Docker Desktop et aux installations Docker
  Engine récentes — la commande est `docker compose`, sans tiret).

Vérifiez avec :

```bash
docker --version
docker compose version
```

## 1. Configurer les variables d'environnement

Avant le premier lancement, copiez le gabarit et remplissez-le :

```bash
cp .env.example .env
```

Éditez `.env` et renseignez au minimum :

- `POSTGRES_PASSWORD` — mot de passe de la base PostgreSQL (obligatoire,
  Docker Compose refuse de démarrer sans elle).
- `AUTH_SECRET` — secret de signature des sessions Auth.js (obligatoire).
  **Ne réutilisez jamais le secret de développement local pour la
  production.** Générez-en un nouveau, dédié et robuste :

  ```bash
  openssl rand -base64 32
  ```

  (si `openssl` n'est pas disponible : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)

- `AUTH_URL` — laissez `http://localhost:3000` pour un test local ;
  ajustez avec le domaine réel si l'application est exposée publiquement.

`POSTGRES_USER` et `POSTGRES_DB` ont des valeurs par défaut raisonnables
(`sim_portail`) si vous ne les modifiez pas. `DATABASE_URL` n'a **pas**
besoin d'être renseignée pour un usage Docker : `docker-compose.yml` la
construit automatiquement à partir des variables `POSTGRES_*`, en pointant
vers le service `db` par son nom réseau Docker (jamais `localhost`).

Ce même fichier `.env` est lu à la fois par Docker Compose (interpolation
des `${...}` de `docker-compose.yml`) et par l'application en
développement local direct (`npm run dev`, sans Docker) — un seul fichier
suffit aux deux usages.

## 2. Construire et démarrer les conteneurs

```bash
docker compose up -d --build
```

Cette commande :

1. Construit l'image de l'application (`Dockerfile`, build multi-étapes).
2. Démarre le conteneur `db` (PostgreSQL) et attend qu'il soit **prêt**
   (healthcheck `pg_isready`) avant de démarrer `app`.
3. Au démarrage du conteneur `app`, `docker-entrypoint.sh` applique
   automatiquement les migrations Prisma en attente (`prisma migrate
   deploy`) avant de lancer le serveur Next.js.

L'application est ensuite accessible sur **http://localhost:3000**.

## 3. Initialiser les données de référence (seed) — une seule fois

**Les migrations tournent automatiquement à chaque démarrage du conteneur
`app` (c'est sans danger, `migrate deploy` n'applique que les migrations
non encore appliquées).** Le seed, en revanche, **n'est jamais exécuté
automatiquement** : `prisma/seed.ts` efface (`deleteMany`) les catégories,
objets, rôles et comptes de test avant de les recréer — l'exécuter à
chaque redémarrage supprimerait les vraies données de l'application.

Lancez-le manuellement, une seule fois, juste après le tout premier
démarrage (base vide) :

```bash
docker compose exec app npx prisma db seed
```

**Ne relancez cette commande que si vous savez explicitement que vous
voulez réinitialiser les données de référence** (elle repart de zéro sur
les tables qu'elle gère).

Si besoin d'appliquer les migrations manuellement (normalement inutile,
elles tournent déjà au démarrage) :

```bash
docker compose exec app npx prisma migrate deploy
```

## 4. Consulter les logs

```bash
docker compose logs -f app
```

(`-f` suit les logs en continu ; retirez-le pour un affichage ponctuel.
Remplacez `app` par `db` pour les logs de PostgreSQL, ou omettez le nom de
service pour voir les deux.)

## 5. Arrêter / redémarrer

Redémarrage propre (conserve les conteneurs et les volumes, donc toutes
les données) :

```bash
docker compose restart
```

Arrêt des conteneurs (les volumes nommés — donc les données PostgreSQL —
**sont conservés**) :

```bash
docker compose down
```

Pour repartir complètement de zéro (⚠️ **supprime aussi les données**,
y compris la base PostgreSQL et le futur stockage de pièces jointes) :

```bash
docker compose down -v
```

## 6. Stockage des pièces jointes (à venir)

La fonctionnalité de pièce jointe sur les demandes/retours de caisse
(modèle `PieceJointe` dans `prisma/schema.prisma`) **n'est pas encore
implémentée** côté application. L'infrastructure est en revanche déjà
prête à l'accueillir : `docker-compose.yml` définit un volume nommé
`uploads`, monté sur `/app/uploads` dans le conteneur `app`, créé et
possédé par l'utilisateur applicatif non-root — aucun changement de
configuration Docker ne sera nécessaire le jour où cette fonctionnalité
sera développée.

## Récapitulatif des choix techniques

- **Image de base Debian** (`node:20-bookworm-slim`), pas Alpine — voir
  les commentaires en tête du `Dockerfile` pour le détail de l'analyse
  Prisma (driver adapter `@prisma/adapter-pg`, pas de moteur de requête
  binaire au runtime, `binaryTargets` volontairement non ajouté).
- **Build multi-étapes** (`deps` → `builder` → `prod-deps` → `runner`) :
  l'image finale ne contient que le strict nécessaire à l'exécution, pas
  les outils de compilation.
- **Utilisateur non-root** (`nextjs`, uid 1001) dans le conteneur final.
- **Migrations automatiques, seed manuel** — voir section 3 ci-dessus.

Pour le détail complet des choix d'architecture, voir la section
"Déploiement Docker" de [CLAUDE.md](CLAUDE.md).
