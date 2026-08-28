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
  `tailwind.config` — tokens de design définis dans `globals.css`, voir
  [Design system](#design-system--composants-ui) plus bas).
- **sonner** pour les toasts, **zod** pour la validation de formulaires côté
  serveur (voir [Toasts et gestion des erreurs](#toasts-et-gestion-des-erreurs)).
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
├── prisma7.config.ts            # Config Prisma 7 (chemin schema, migrations, DATABASE_URL, seed)
├── src/
│   ├── app/                      # Routes (App Router), groupées par domaine
│   │   ├── layout.tsx              # Layout racine (fonts Geist, Tailwind, <Toaster/>)
│   │   ├── page.tsx                 # Page d'accueil
│   │   ├── globals.css              # Tokens de design (couleurs) + config Tailwind v4
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx           # Page de connexion (formulaire + Server Action)
│   │   ├── (dev)/
│   │   │   └── ui-preview/
│   │   │       ├── page.tsx            # Vitrine des composants src/components/ui (OUTIL DE DEV)
│   │   │       ├── UiPreviewDemo.tsx    # Partie interactive (Client Component)
│   │   │       └── actions.ts           # Server Action de démo (zod + ActionState)
│   │   └── api/
│   │       └── auth/
│   │           └── [...nextauth]/
│   │               └── route.ts          # Handlers Auth.js (GET/POST)
│   │   # À venir (dev #2) : (dashboard)/ (écrans transverses type dashboard Finance,
│   │   # reporting), admin/ (gestion rôles/permissions/modules), treso/ (écrans
│   │   # Trésorerie : demandes, règlements, retours de caisse). Créer ces groupes
│   │   # de routes au fur et à mesure des écrans réels — ne pas créer de dossiers vides.
│   ├── components/
│   │   ├── ui/                    # Composants génériques réutilisables, sans logique métier
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Textarea.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── FormField.tsx
│   │   │   ├── DataTable.tsx
│   │   │   ├── PageHeader.tsx
│   │   │   ├── Badge.tsx
│   │   │   └── index.ts             # Barrel export : `import { Button, Input } from "@/components/ui"`
│   │   # À venir (dev #2) : src/components/tresorerie/ (ex: DemandeForm.tsx,
│   │   # ReglementCard.tsx) pour les composants spécifiques au métier Trésorerie.
│   ├── lib/                       # Utilitaires, auth, prisma, helpers
│   │   ├── auth.ts                  # Config Auth.js + contrat getSession()/hasPermission()
│   │   ├── prisma.ts                # Singleton PrismaClient (driver adapter pg)
│   │   ├── validation.ts            # ActionState, fieldErrorsFromZod (pattern Server Action + zod)
│   │   └── hooks/
│   │       └── useActionFeedback.ts   # Relie un ActionState à un toast sonner
│   ├── types/
│   │   └── next-auth.d.ts           # Augmentation des types Session/User/JWT d'Auth.js
│   └── generated/
│       └── prisma/                  # Client Prisma généré (ne pas éditer, ne pas committer de logique ici)
├── public/                        # Assets statiques
└── package.json
```

## Conventions de code

- **Nommage des fichiers** :
  - Composants React : `PascalCase.tsx` (ex: `DemandeForm.tsx`, `Button.tsx`).
  - Fichiers utilitaires / non-composants : `camelCase.ts` (ex: `formatCurrency.ts`, `useActionFeedback.ts`).
  - Dossiers multi-mots : `kebab-case` (ex: `ui-preview`, à l'exception des
    groupes de routes App Router qui suivent la convention Next.js `(nom)`).
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
- **Import des composants UI** : passer par le barrel
  `import { Button, Input, ... } from "@/components/ui"` plutôt que par des
  chemins profonds (`@/components/ui/Button`), sauf cas de tree-shaking
  particulier.

### Où placer un nouveau composant

| Le composant... | va dans... | exemple |
|---|---|---|
| ne connaît aucune notion métier, réutilisable dans n'importe quelle app (bouton, champ, tableau générique) | `src/components/ui/` | `Modal.tsx`, `Tabs.tsx` |
| est spécifique à un domaine métier (Trésorerie, Admin...) mais réutilisé sur plusieurs écrans de ce domaine | `src/components/<domaine>/` (créer le dossier au besoin) | `src/components/tresorerie/DemandeForm.tsx` |
| n'est utilisé que par une seule page | à côté de la page, dans le dossier de la route | `src/app/(treso)/demandes/[id]/DemandeDetail.tsx` |

Règle simple : si tu hésites entre `ui/` et un dossier métier, demande-toi
si le composant aurait un sens dans une application sans lien avec les
assurances. Si oui → `ui/`. Si non → dossier de domaine.

## Design system & composants UI

Les tokens de couleur sont définis une seule fois dans
[src/app/globals.css](src/app/globals.css) (`--color-primary`,
`--color-danger`, `--color-success`, `--color-warning`, `--color-info`,
`--color-neutral`, `--color-border`, `--color-muted`...) et exposés comme
classes Tailwind (`bg-primary`, `text-danger`, `border-border`...). **Ne
jamais coder une couleur en dur dans un composant** (`bg-blue-600`,
`#1d4ed8`...) — passer par ces tokens pour que toute évolution de palette
se fasse à un seul endroit. Palette volontairement sobre (bleu/gris),
adaptée à une application interne — pas de mode sombre pour l'instant.

Une page de démonstration montre tous les composants avec des exemples
concrets : voir [Page de démo UI](#page-de-démo-ui) plus bas.

Composants disponibles dans `src/components/ui/` (tous importables via
`@/components/ui`) :

- **Button** — variantes `primary` / `secondary` / `danger`, prop `loading`
  (affiche un spinner et désactive le bouton), prop `disabled` standard.
  ```tsx
  <Button variant="primary" loading={isPending}>Enregistrer</Button>
  ```
- **Input** / **Textarea** — champ texte / zone de texte avec `label`,
  `error` et `hint` optionnels, `required` pour l'astérisque. Composent
  `FormField` en interne.
  ```tsx
  <Input label="Description" required error={state.fieldErrors?.description} />
  <Textarea label="Commentaire" rows={4} hint="Optionnel" />
  ```
- **Select** — liste déroulante avec `options: {value, label}[]` et
  `placeholder` optionnel.
  ```tsx
  <Select
    label="Catégorie"
    placeholder="Choisir..."
    options={categories.map((c) => ({ value: c.id, label: c.label }))}
    error={state.fieldErrors?.categorieId}
  />
  ```
- **FormField** — wrapper label + champ + erreur. `Input`/`Textarea`/`Select`
  l'utilisent déjà en interne ; ne l'utiliser directement que pour un champ
  personnalisé (composant tiers, groupe de cases à cocher...).
  ```tsx
  <FormField label="Justificatif" htmlFor="piece" required error={error}>
    <CustomFileInput id="piece" />
  </FormField>
  ```
- **Badge** — étiquette de statut générique, variantes `neutral` / `info` /
  `success` / `warning` / `danger`. Ne connaît aucun enum métier : voir
  [Badges de statut métier](#badges-de-statut-métier) pour l'associer à
  `StatutDemande`/`ModeReglement`.
  ```tsx
  <Badge variant="success">Validée</Badge>
  ```
- **DataTable** — tableau générique, colonnes/lignes en props, tri basique
  par colonne (si `sortable: true` + `accessor` fournis sur la colonne).
  ```tsx
  <DataTable
    rowKey={(d) => d.id}
    columns={[
      { key: "reference", header: "Référence", sortable: true, accessor: (d) => d.reference },
      { key: "montant", header: "Montant", sortable: true, accessor: (d) => d.montant,
        render: (d) => formatCurrency(d.montant) },
      { key: "statut", header: "Statut", render: (d) => <Badge variant={statutVariant[d.statut]}>{d.statut}</Badge> },
    ]}
    data={demandes}
  />
  ```
- **PageHeader** — en-tête de page standard (titre, description optionnelle,
  zone d'actions à droite). À placer en haut de chaque écran.
  ```tsx
  <PageHeader
    title="Demandes"
    description="Suivi des demandes de dépense en cours"
    actions={<Button>Nouvelle demande</Button>}
  />
  ```

### Badges de statut métier

`Badge` reste générique à dessein (pas de dépendance aux enums Prisma).
Pour afficher un statut métier, mapper la valeur vers une variante via un
petit objet local **dans le composant qui affiche la donnée** :

```tsx
const statutBadgeVariant: Record<StatutDemande, BadgeVariant> = {
  EN_ATTENTE: "warning",
  VALIDEE: "success",
  REJETEE: "danger",
  CLOTUREE_TOTALE: "neutral",
  CLOTUREE_PARTIELLE: "info",
};

<Badge variant={statutBadgeVariant[demande.statut]}>{demande.statut}</Badge>
```

Cette convention est démontrée dans `src/app/(dev)/ui-preview/UiPreviewDemo.tsx`.

## Toasts et gestion des erreurs

Le `<Toaster />` de [sonner](https://sonner.emilkowal.ski/) est monté une
fois pour toute l'application dans
[src/app/layout.tsx](src/app/layout.tsx) : n'importe quel Client Component
peut déclencher un toast sans provider supplémentaire.

### Depuis un Client Component

```tsx
"use client";
import { toast } from "sonner";

toast.success("Demande créée.");
toast.error("Une erreur est survenue.");
toast.info("Information.");
```

### Depuis une Server Action (formulaire)

Une Server Action ne peut pas appeler `toast()` directement (elle s'exécute
côté serveur, sans DOM). Le pattern standard du portail :

1. La Server Action retourne un `ActionState` (type défini dans
   [src/lib/validation.ts](src/lib/validation.ts)) — jamais une exception
   pour un cas métier attendu (validation invalide, etc.).
2. Le Client Component pilote le formulaire avec `useActionState` (React 19)
   et relie l'état obtenu à un toast via le hook `useActionFeedback`.
3. Les erreurs de champ (`fieldErrors`) sont passées directement à la prop
   `error` de `Input`/`Select`/`Textarea`.

```ts
// src/app/(treso)/demandes/actions.ts
"use server";
import { z } from "zod";
import { fieldErrorsFromZod, type ActionState } from "@/lib/validation";

const schema = z.object({
  description: z.string().min(3, "Description trop courte"),
  montant: z.coerce.number().positive("Montant invalide"),
});

export async function creerDemandeAction(
  _prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = schema.safeParse({
    description: formData.get("description"),
    montant: formData.get("montant"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Formulaire invalide", fieldErrors: fieldErrorsFromZod(parsed.error) };
  }

  // ... écriture en base + historisation (HistoriqueEntry) ...

  return { status: "success", message: "Demande créée." };
}
```

```tsx
// src/app/(treso)/demandes/DemandeForm.tsx
"use client";
import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import { useActionFeedback } from "@/lib/hooks/useActionFeedback";
import { IDLE_ACTION_STATE } from "@/lib/validation";
import { creerDemandeAction } from "./actions";

export function DemandeForm() {
  const [state, formAction, isPending] = useActionState(creerDemandeAction, IDLE_ACTION_STATE);
  useActionFeedback(state);

  return (
    <form action={formAction} className="space-y-4">
      <Input
        name="description"
        label="Description"
        required
        error={state.status === "error" ? state.fieldErrors?.description : undefined}
      />
      <Input
        name="montant"
        label="Montant"
        type="number"
        required
        error={state.status === "error" ? state.fieldErrors?.montant : undefined}
      />
      <Button type="submit" loading={isPending}>Créer</Button>
    </form>
  );
}
```

Ce pattern complet (formulaire + Server Action + zod + toast + erreurs par
champ) est démontré de bout en bout dans la [page de démo UI](#page-de-démo-ui).

## Page de démo UI

[src/app/(dev)/ui-preview/page.tsx](<src/app/(dev)/ui-preview/page.tsx>)
(route `/ui-preview`) affiche tous les composants de `src/components/ui`
avec des exemples d'usage réels : variantes de Button, Badges de statut,
DataTable triable, déclenchement de toasts, et un formulaire complet
Server Action + zod + gestion d'erreurs par champ.

**C'est un outil de développement, pas un écran du produit.** À supprimer
(ou à protéger derrière une permission admin) avant mise en production.
Ne pas y référencer de vraies données métier.

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
