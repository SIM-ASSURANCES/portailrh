# sim-portail

## Objectif du projet

Portail interne modulaire pour **SIM Assurances**. L'application est pensée
pour accueillir plusieurs modules métier indépendants derrière un socle
commun (utilisateurs, rôles, permissions, historisation).

Le premier module livré est **Trésorerie** : gestion des demandes de
dépense, de leur validation, des règlements (caisse ou banque) et des
retours de caisse.

## Stack technique

- **Next.js 16** (App Router, dossier `src/app`), React 19, TypeScript strict.
- **Prisma 7** avec le générateur `prisma-client` (et non `prisma-client-js`) :
  le client est généré dans `src/generated/prisma` et importé via l'alias
  `@/generated/prisma/client`.
- **Driver adapter `@prisma/adapter-pg`** : Prisma 7 n'embarque plus de moteur
  binaire par défaut, la connexion PostgreSQL passe explicitement par `pg` +
  `PrismaPg`. Voir [src/lib/prisma.ts](src/lib/prisma.ts).
- **PostgreSQL** en local (base `sim_portail`).
- **Auth.js / NextAuth v5** (`next-auth@beta`) avec un provider Credentials
  (email + mot de passe), sessions **JWT** (pas d'adapter Prisma — voir
  [Authentification](#authentification) plus bas).
- **Tailwind CSS v4** (via `@tailwindcss/postcss`, pas de fichier
  `tailwind.config` — configuration inline dans `globals.css`).
- **bcryptjs** pour le hachage des mots de passe.
- Config Prisma centralisée dans `prisma7.config.ts` (et non dans le bloc
  `datasource` de `schema.prisma`, qui ne contient pas d'URL).

## Structure des dossiers

```
sim-portail/
├── prisma/
│   ├── schema.prisma          # Tous les modèles (Socle + Trésorerie)
│   ├── seed.ts                 # Script de seed (rôles, permissions, users de test, catégories/objets)
│   └── migrations/              # Historique des migrations SQL
├── prisma7.config.ts            # Config Prisma 7 (chemin schema, migrations, DATABASE_URL)
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Layout racine (fonts Geist, Tailwind)
│   │   ├── page.tsx               # Page d'accueil
│   │   ├── globals.css            # Styles globaux / config Tailwind v4
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx        # Page de connexion (formulaire + Server Action)
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts     # Handlers Auth.js (GET/POST)
│   ├── lib/
│   │   ├── prisma.ts               # Singleton PrismaClient (driver adapter pg)
│   │   └── auth.ts                  # Config Auth.js + contrat getSession()/hasPermission()
│   ├── types/
│   │   └── next-auth.d.ts           # Augmentation des types Session/User/JWT d'Auth.js
│   └── generated/
│       └── prisma/                  # Client Prisma généré (ne pas éditer, ne pas committer de logique ici)
├── public/                        # Assets statiques
└── package.json
```

Cette arborescence sera complétée au fil des modules (ex: `src/app/(portail)/tresorerie/...`,
`src/lib/permissions.ts`, `src/components/...`) : garder ce fichier à jour à
mesure que de nouveaux dossiers structurants apparaissent.

## Conventions de code

- **Nommage des fichiers** : `kebab-case` pour les fichiers non-composants
  (`auth.ts`, `prisma.ts`), `PascalCase` implicite pour les composants React
  via les conventions App Router (`page.tsx`, `layout.tsx`).
- **Domaine métier en français** : les modèles Prisma, les clés de
  permissions (`treso.valider_demande`) et les libellés utilisateur restent
  en français, cohérent avec le métier (SIM Assurances). Le code
  (variables, fonctions, commentaires techniques) peut être en français ou
  anglais selon le fichier existant — rester cohérent avec le fichier édité.
- **Accès Prisma** : toujours passer par le singleton `@/lib/prisma`
  (jamais `new PrismaClient()` ailleurs), pour éviter la multiplication des
  pools de connexions en dev (hot-reload).
- **Import du client Prisma généré** : `@/generated/prisma/client` (alias
  `@/*` → `./src/*` défini dans `tsconfig.json`). Le dossier généré n'a pas
  de `package.json`/`index.ts` : toujours importer depuis `client.ts`
  explicitement.
- **Auth / permissions** : ne jamais dupliquer la logique de vérification
  des droits. Toute page/route/action qui doit être protégée appelle
  `getSession()` puis `hasPermission(session, "cle.permission")` depuis
  `@/lib/auth`.
- **Regroupement par domaine** : au fur et à mesure des modules, regrouper
  le code métier par domaine (ex: `src/lib/tresorerie/`) plutôt que par type
  technique.

## Règles métier impératives — Module Trésorerie

Ces règles sont non négociables et doivent guider toute implémentation
(UI, actions serveur, API) touchant aux demandes, règlements et à la caisse :

1. **La validation d'une demande est un verrouillage définitif.** Une fois
   `statut = VALIDEE`, la demande ne peut plus être modifiée dans son fond
   (montant, description, catégorie, objet, budget).
2. **Catégorie / objet / budget disponible ne sont modifiables que par le
   rôle Finance, et uniquement avant validation.** Après validation, plus
   aucune modification de ces champs, par personne.
3. **Un règlement en mode BANQUE n'impacte jamais la caisse.** Seuls les
   règlements en mode CAISSE alimentent le solde de caisse.
4. **Déclarer un retour ≠ réceptionner un retour.** Ce sont deux actions et
   deux acteurs distincts (`RetourCaisse.declarantId` /
   `RetourCaisse.receptionneParId`). **Seule la réception
   (`estReceptionne = true`) impacte réellement le solde de caisse** ; la
   déclaration seule ne fait qu'enregistrer une intention/justification.
5. **Toute correction est une annulation tracée, jamais une édition
   silencieuse.** Un règlement ou un retour erroné se corrige via
   `estAnnule` / `motifAnnulation` (ou équivalent), pas en réécrivant les
   valeurs existantes. L'historique doit rester intégralement reconstituable.
6. **Le solde de caisse n'est jamais saisi manuellement : il est toujours
   calculé** à partir des mouvements enregistrés dans `JournalCaisse`
   (règlements caisse confirmés, retours réceptionnés).
7. **Toute opération importante doit être historisée dans
   `HistoriqueEntry`** (création/validation/rejet de demande, règlement,
   déclaration/réception de retour, clôture, annulation...), avec l'auteur
   (`userId`) et un `detail` exploitable.

## Authentification

- Provider **Credentials** uniquement pour l'instant (email + mot de passe
  vérifié avec `bcrypt.compare` contre `User.passwordHash`).
- Stratégie de session **JWT** (pas de session base de données / pas
  d'`@auth/prisma-adapter`) : Auth.js ne supporte pas les sessions
  persistées en base avec le Credentials provider.
- Le contrat applicatif à utiliser dans le reste du code est
  `getSession()` / `hasPermission()` exportés par
  [src/lib/auth.ts](src/lib/auth.ts) — voir les commentaires du fichier pour
  le détail d'usage. Ne pas appeler `auth()` directement en dehors de ce
  fichier pour la vérification de permissions.

## Où trouver le schéma de données

Le schéma complet (modèles, enums, relations) est dans
[prisma/schema.prisma](prisma/schema.prisma).

## Lancer le projet

```bash
npm install                # installer les dépendances
npx prisma migrate dev     # appliquer les migrations sur la base locale
npx prisma db seed         # peupler la base (rôles, permissions, 4 comptes de test, catégories/objets)
npm run dev                # démarrer le serveur de développement
```

Prérequis : un fichier `.env` avec `DATABASE_URL` (PostgreSQL) et
`AUTH_SECRET` (secret de signature des JWT Auth.js, généré avec
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

Comptes de test (mot de passe `password123` pour tous) :
`collaborateur@simassurances.test`, `finance@simassurances.test`,
`dg@simassurances.test`, `admin@simassurances.test`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
