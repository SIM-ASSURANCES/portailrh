<!-- title: Déploiement Docker -->

# Déploiement de sim-portail avec Docker

> **Passage en production (sauvegarde, rattrapage des données, rôles, purge des données de test, solde d'ouverture, vérification, retour arrière, levée du verrou
> de réinitialisation) : suivre [docs/mise-en-production.md](docs/mise-en-production.md).** Les tâches planifiées sont intégrées à l'application (§ 7) : aucun cron-job.org.

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

- `AUTH_URL` — laissez `http://localhost:3000` pour un test local. **En production, c'est l'URL publique réelle**
  (schéma et domaine exacts, ex. `https://portail.example.ci`) : elle sert de référence au retour après connexion (un
  lien reçu par e-mail ramène sur la bonne page) et préfixe les liens des e-mails. Mal renseignée, l'utilisateur
  retombe sur l'accueil après connexion au lieu de la page demandée.
  (Depuis le 2026-10-15, tous les liens d'e-mails passent par `urlPublique()` : `AUTH_URL` seule suffit, `NEXTAUTH_URL` n'est pas nécessaire.)
- `CRON_SECRET` — secret du déclenchement manuel des tâches (voir « 7. Tâches planifiées »). Sans lui, les routes `/api/cron/*`
  refusent tout appel (401). Générez-le avec `openssl rand -hex 24`.

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
démarrage (base vide) — depuis `backend/`, où vivent le schéma et la
config Prisma (voir CLAUDE.md "Monorepo backend/frontend") :

```bash
docker compose exec app sh -c "cd backend && npx prisma db seed"
```

**Ne relancez cette commande que si vous savez explicitement que vous
voulez réinitialiser les données de référence** (elle repart de zéro sur
les tables qu'elle gère).

Si besoin d'appliquer les migrations manuellement (normalement inutile,
elles tournent déjà au démarrage) :

```bash
docker compose exec app sh -c "cd backend && npx prisma migrate deploy"
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

## 7. Tâches planifiées (planificateur intégré)

Depuis le 2026-10-14, les tâches planifiées tournent **dans l'application** (`frontend/src/instrumentation.ts` démarre un
planificateur au lancement du serveur) : plus de dépendance à cron-job.org ni à un conteneur `cron`.

| Tâche | Cadence (heure du serveur, UTC = heure d'Abidjan) |
|---|---|
| Relances de justification du pointage (retard, départ anticipé) | toutes les 5 minutes |
| Absences et oublis de départ | du lundi au vendredi, à 17:30 et 20:00 |
| Purge des journaux (exécutions de plus de 90 jours) | chaque jour à 03:00 |

- **Une seule exécution à la fois**, même avec deux instances : verrou consultatif PostgreSQL par tâche ; une exécution qui
  trouve le verrou pris est enregistrée « ignorée ».
- **Rattrapage** : une exécution manquée parce que le serveur était arrêté est lancée au redémarrage (premier passage
  15 secondes après le démarrage, puis une vérification par minute).
- **Suivi** : chaque exécution (planifiée ou manuelle) laisse une ligne dans la table `ExecutionTache`, affichée par le
  moniteur de `/admin/journal-technique` (dernière exécution, prochaine attendue, badge « En retard », bouton « Lancer
  maintenant »).
- `PLANIFICATEUR_ACTIF=false` désactive le planificateur d'une instance (à réserver aux tests ou à une instance secondaire).
- Les routes `/api/cron/relances-justification` et `/api/cron/absences` **restent** : déclenchement manuel ou de secours,
  protégé par `Authorization: Bearer <CRON_SECRET>` (401 sans en-tête valide ou sans `CRON_SECRET` configuré). Elles passent
  par le même verrou et écrivent la même ligne d'exécution (déclenchement « manuel »).

**Le jour du déploiement : supprimer les tâches cron-job.org** (relances et absences). Sinon les routes seraient appelées
en plus du planificateur : sans conséquence sur les données (tâches idempotentes, verrou), mais inutile.

Penser aussi à vérifier sur `/admin/notifications` que les responsables de service ont activé les notifications push.

## 8. Activation du planificateur et purge du Pointage (comptes de test)

**À faire AVANT de déployer cette version en production.**

1. **Neutraliser les comptes de test** (`admin@simassurances.test`, `dg@`, `finance@`, `rh@`, `collaborateur@`, `assistant-finance@`, `responsable-*@`, `enc-*@`…, tous les
   `*@simassurances.test`) : **les DÉSACTIVER** dans `/admin/users` (connexion refusée, sessions en cours coupées, historique intact, réversible) — **jamais les supprimer**.
   Raison : le rôle Admin reçoit la permission `pointage.reinitialiser` (migration `20261014120000`) ; un compte Admin au mot de passe de test connu pourrait **purger le
   Pointage**. Le rôle DG reçoit déjà `systeme.reinitialiser` et `enc.mettre_en_service` : même consigne.
2. **Ou démarrer avec `PLANIFICATEUR_ACTIF=false`** (variable de l'onglet Environment de Dokploy) tant que ces comptes ne sont pas neutralisés, puis supprimer la variable (ou la
   passer à `true`) et redéployer. Sans planificateur, aucune relance ni absence automatique ne part, et la clôture initiale n'a pas lieu.
3. **Premier passage du planificateur en production** : clôture initiale, une seule fois (marqueur `MarqueurUnique`), sans aucun envoi — justifications `EN_ATTENTE` d'avant le jour
   courant → `NON_JUSTIFIEE`, absences `A_CONTROLER` d'avant le jour courant → `CONFIRMEE`. Le nombre de clôtures est écrit au journal technique (`/admin/journal-technique`, code
   `CLOTURE_INITIALE`). Pour que l'arriéré de test soit traité à ce moment-là, ne démarrer le planificateur qu'après avoir décidé de la purge du Pointage (point suivant).
4. **Purge du Pointage seul** (`/admin/reinitialisation-pointage`, permission `pointage.reinitialiser`) : sauvegarde JSON téléchargée (empreinte SHA-256), mot `REINITIALISER-POINTAGE`,
   une transaction. Répétable jusqu'à **« Mettre le Pointage en service »** (mot `METTRE-EN-SERVICE-POINTAGE`, définitif : plus aucune purge ensuite). Les fichiers de `uploads/` ne
   sont pas concernés. **Aucun réglage de `SYSTEM_START_DATE` n'est nécessaire** : la date de chaque purge est enregistrée à l'audit et la tâche des absences ne crée jamais d'absence antérieure
   au lendemain de la dernière purge (ni à la mise en service du Pointage) ; `SYSTEM_START_DATE` reste seulement un plancher de configuration.
5. La réinitialisation **globale** (`/systeme/reinitialisation`) a déjà été exécutée en production (26/09/2026) et est verrouillée : elle n'est pas concernée.

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
- **Monorepo `backend/`/`frontend/`** (voir CLAUDE.md "Monorepo
  backend/frontend") — le déploiement reste **une seule image, un seul
  conteneur applicatif**, exactement comme avant : `backend` (schéma
  Prisma + logique métier) est directement compilé/inliné dans le build
  Next.js (aucun serveur séparé), seuls son schéma et sa configuration
  Prisma sont copiés à part dans l'image, pour les migrations/le seed en
  CLI.

Pour le détail complet des choix d'architecture, voir la section
"Déploiement Docker" de [CLAUDE.md](CLAUDE.md).
