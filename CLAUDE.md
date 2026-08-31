# sim-portail

## Objectif du projet

Portail interne modulaire pour **SIM Assurances**. L'application est pensée
pour accueillir plusieurs modules métier indépendants derrière un socle
commun (utilisateurs, rôles, permissions, historisation).

Le premier module livré est **Trésorerie** : gestion des demandes de
dépense, de leur validation, des règlements (caisse ou banque) et des
retours de caisse.

Un deuxième module est en préparation : **Pointage RH**, suivi des
arrivées/départs, retards et absences du personnel. Les fondations de
données et le parcours de pointage collaborateur par QR code sont en place
(voir [Module Pointage RH : fondations de données](#module-pointage-rh--fondations-de-données)).

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
  [Design system](#design-system--composants-ui) plus bas). Palette et
  police issues de la charte graphique officielle SIM Assurances.
- **Montserrat** (`next/font/google`) : police institutionnelle, appliquée
  par défaut à tout le projet (voir [Typographie](#typographie)).
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
│   │   ├── layout.tsx              # Layout racine (police Montserrat, Tailwind, <Toaster/>)
│   │   ├── globals.css              # Tokens de design (couleurs charte + police) + config Tailwind v4
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       └── page.tsx           # Page de connexion (formulaire + Server Action)
│   │   ├── (dashboard)/               # Socle Portail : écrans authentifiés
│   │   │   ├── layout.tsx              # En-tête institutionnel (logo, nav, garde de session)
│   │   │   ├── page.tsx                 # Dashboard "/" : modules accessibles, notifications, actions
│   │   │   └── admin/                    # Console d'administration (route "/admin", réservée à isAdmin())
│   │   │       ├── layout.tsx              # Garde isAdmin() -> redirect("/?error=acces_refuse_admin")
│   │   │       ├── page.tsx                 # Accueil admin (cartes vers users/roles/modules)
│   │   │       ├── users/                    # Gestion des utilisateurs (créer, activer/désactiver)
│   │   │       ├── roles/                    # Permissions par rôle (cases à cocher par module)
│   │   │       ├── modules/                  # Activation/désactivation des modules
│   │   │       └── categories/                # Catégories/Objets Trésorerie (Ticket A.1)
│   │   │           ├── page.tsx                  # Liste imbriquée + formulaires de création
│   │   │           ├── CategorieCreateForm.tsx    # Client, useActionState
│   │   │           ├── ObjetCreateForm.tsx        # Client, categorieId en champ caché
│   │   │           ├── CategoriesList.tsx         # Client, liste + toggles imbriqués
│   │   │           ├── ActiveToggleButton.tsx     # Bouton Activer/Désactiver générique
│   │   │           └── actions.ts                 # créer/toggle Categorie et Objet
│   │   ├── (dashboard)/treso/            # Module Trésorerie (écrans métier)
│   │   │   └── demandes/
│   │   │       ├── page.tsx                # "Mes demandes" (liste filtrée par créateur)
│   │   │       ├── MesDemandesTable.tsx     # Wrapper Client de DataTable (voir plus bas)
│   │   │       ├── nouvelle/
│   │   │       │   ├── page.tsx               # Formulaire, gardé par treso.creer_demande
│   │   │       │   ├── DemandeForm.tsx         # Client Component (useActionState)
│   │   │       │   └── actions.ts              # Server Action creerDemandeAction (zod + ActionState)
│   │   │       └── [id]/
│   │   │           ├── page.tsx               # Détail Collaborateur (créateur uniquement)
│   │   │           ├── retourActions.ts        # creerRetourCaisseAction (jamais de JournalCaisse)
│   │   │           ├── RetoursCaisseSection.tsx # Server Component, règlements Caisse éligibles
│   │   │           ├── RetourCaisseRow.tsx      # Bouton/formulaire par règlement (Client)
│   │   │           ├── RetourCaisseForm.tsx     # Formulaire de déclaration (Client, useActionState)
│   │   │           └── ReglementsRecusSection.tsx # Règlements confirmés + "Télécharger le reçu" (Ticket 9)
│   │   │   └── finance/
│   │   │       ├── layout.tsx              # Garde categoriser/valider/receptionner_retour/dashboard/reporting
│   │   │       ├── page.tsx                # Dashboard Finance (4 StatCard, Ticket 8)
│   │   │       ├── reporting/
│   │   │       │   ├── page.tsx               # Écran de reporting + suivi budgétaire (Ticket 10)
│   │   │       │   └── ReportingFiltersForm.tsx # Filtres en GET, cascade Catégorie->Objet (Client)
│   │   │       ├── a-decaisser/
│   │   │       │   ├── page.tsx               # Demandes VALIDEE, reste à régler > 0
│   │   │       │   └── ADecaisserTable.tsx
│   │   │       ├── a-regulariser/
│   │   │       │   ├── page.tsx               # Demandes VALIDEE, reste à régler = 0, non clôturées
│   │   │       │   └── ARegulariserTable.tsx
│   │   │       ├── retours/
│   │   │       │   ├── page.tsx               # "Retours en attente" (garde receptionner_retour)
│   │   │       │   ├── RetoursEnAttenteTable.tsx
│   │   │       │   └── retourActions.ts        # receptionnerRetourAction (ENTREE JournalCaisse)
│   │   │       └── demandes/
│   │   │           ├── page.tsx               # "Demandes à catégoriser" (toutes, tri par ancienneté)
│   │   │           ├── DemandesACategoriserTable.tsx
│   │   │           └── [id]/
│   │   │               ├── page.tsx               # Détail + rendu conditionnel statut x permission
│   │   │               ├── CategorisationForm.tsx  # Select Catégorie->Objet en cascade (Client)
│   │   │               ├── ValidationActions.tsx    # Boutons Valider/Rejeter (Client, useTransition)
│   │   │               ├── actions.ts              # categoriser/valider/rejeter/cloturerDemandeAction
│   │   │               ├── ReglementsSection.tsx    # Totaux + liste (Server Component, si VALIDEE)
│   │   │               ├── ReglementForm.tsx        # Ajout d'un règlement (Client, useActionState)
│   │   │               ├── ReglementRow.tsx         # Modifier/Confirmer/Annuler par ligne (Client)
│   │   │               ├── reglementActions.ts      # créer/modifier/confirmer/annulerReglementAction
│   │   │               └── ClotureActions.tsx        # Boutons Clôturer totalement/partiellement (Client)
│   │   ├── (dev)/
│   │   │   └── ui-preview/
│   │   │       ├── page.tsx            # Vitrine des composants src/components/ui (OUTIL DE DEV)
│   │   │       ├── UiPreviewDemo.tsx    # Partie interactive (Client Component)
│   │   │       └── actions.ts           # Server Action de démo (zod + ActionState)
│   │   └── api/
│   │       ├── auth/
│   │       │   └── [...nextauth]/
│   │       │       └── route.ts          # Handlers Auth.js (GET/POST)
│   │       └── treso/
│   │           ├── reglements/
│   │           │   └── [id]/
│   │           │       └── recu/
│   │           │           └── route.tsx     # GET : génère le reçu PDF d'un règlement (Ticket 9)
│   │           └── reporting/
│   │               └── export/
│   │                   └── route.ts          # GET : export Excel 6 feuilles (Ticket 10)
│   │   # À venir (dev #2) : le reste du Module Trésorerie (règlements, retours
│   │   # de caisse, validation par DG) sous (dashboard)/treso/, même pattern.
│   │   # Le Socle Portail (auth, permissions, dashboard, admin) est terminé —
│   │   # voir "Socle Portail : statut" plus bas.
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
│   │   │   ├── Card.tsx / StatCard.tsx # Surface générique / carte indicateur (dashboard)
│   │   │   ├── ToastOnMount.tsx     # Déclenche un toast au montage (ex: après un redirect serveur)
│   │   │   └── index.ts             # Barrel export : `import { Button, Input } from "@/components/ui"`
│   │   ├── layout/                # Coquille applicative (voir Design system > Coquille)
│   │   │   └── AppShell.tsx, Sidebar.tsx, Topbar.tsx, nav.ts, actions.ts
│   │   ├── tresorerie/             # Domaine Trésorerie, réutilisé sur plusieurs écrans
│   │   │   ├── demandeStatut.ts      # STATUT_DEMANDE_BADGE_VARIANT / _LABEL (mapping Badge partagé)
│   │   │   ├── DemandeHistorique.tsx  # Historique générique d'une Demande (Server Component autonome)
│   │   │   ├── justification.ts       # JUSTIFICATION_LABEL / _OPTIONS (TypeJustification)
│   │   │   └── RegularisationSummary.tsx # Décaissé/dépenses/retours/écart (Finance ET Collaborateur)
│   │   # À venir (dev #2) : ReglementCard.tsx, etc. (les formulaires restent
│   │   # colocalisés à leur page tant qu'une seule route les utilise).
│   ├── lib/                       # Utilitaires, auth, prisma, helpers
│   │   ├── auth.ts                  # Config Auth.js + contrat getSession()/hasPermission()/isAdmin()/getAccessibleModules()
│   │   ├── prisma.ts                # Singleton PrismaClient (driver adapter pg)
│   │   ├── reference.ts             # generateDemandeReference() : référence lisible "DEM-2026-000123"
│   │   ├── tresorerie.ts            # getTotalRegle/getResteARegler/getSoldeCaisse/getEcart...
│   │   ├── dashboardFinance.ts      # getDemandesADecaisser/getDecaissementsARegulariser/getRetoursEnAttente
│   │   ├── reporting.ts             # Filtres + requêtes du reporting, partagées écran/export (Ticket 10)
│   │   ├── pdf/
│   │   │   └── ReceiptDocument.tsx    # Gabarit @react-pdf/renderer du reçu de règlement (Ticket 9)
│   │   ├── validation.ts            # ActionState, fieldErrorsFromZod (pattern Server Action + zod)
│   │   └── hooks/
│   │       └── useActionFeedback.ts   # Relie un ActionState à un toast sonner
│   ├── types/
│   │   └── next-auth.d.ts           # Augmentation des types Session/User/JWT d'Auth.js
│   └── generated/
│       └── prisma/                  # Client Prisma généré (ne pas éditer, ne pas committer de logique ici)
├── public/                        # Assets statiques
│   └── logo-sim-blanc.webp          # Logo SIM Assurances, version blanche (fonds foncés uniquement)
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

Les tokens de couleur et la police sont définis une seule fois dans
[src/app/globals.css](src/app/globals.css) et exposés comme classes
Tailwind. **Ne jamais coder une couleur en dur dans un composant**
(`bg-blue-600`, `#004B9C`...) — passer par ces tokens pour que toute
évolution de palette se fasse à un seul endroit. Pas de mode sombre pour
l'instant.

Une page de démonstration montre tous les composants, la palette et la
typographie avec des exemples concrets : voir
[Page de démo UI](#page-de-démo-ui) plus bas.

### Palette officielle SIM Assurances

Couleurs de la charte graphique, disponibles telles quelles via
`bg-sim-blue-dark`, `text-sim-red`, etc. :

| Token Tailwind | Hex | Usage charte |
|---|---|---|
| `sim-blue-dark` | `#004B9C` | Couleur principale |
| `sim-blue-light` | `#51AEE2` | Couleur secondaire |
| `sim-red` | `#FE0101` | État "Dommage" / erreur |
| `sim-yellow` | `#FDF20E` | État "Santé" / attention |
| `sim-orange` | `#F16622` | État "Accident" / avertissement |

**Ces couleurs brutes sont réservées aux aplats et accents non-textuels**
(fonds pleins comme l'en-tête du portail, bordures, éléments décoratifs) —
voir la note d'accessibilité ci-dessous avant de les utiliser pour du texte.

Pour l'UI (boutons, badges, messages d'état), utiliser les **tokens
sémantiques**, qui dérivent des couleurs officielles :

| Token | Dérivé de | Usage |
|---|---|---|
| `bg-primary` / `text-primary-foreground` | sim-blue-dark (identique) | Bouton principal, en-tête du portail |
| `bg-danger` / `text-danger` | sim-red (assombri) | Bouton danger, erreurs, badge REJETEE |
| `text-warning` + `bg-warning-bg` | sim-orange (assombri) | Badge d'avertissement (ex: EN_ATTENTE) |
| `text-info` + `bg-info-bg` | sim-blue-light (assombri) | Badge d'information (ex: CAISSE) |
| `text-success` + `bg-success-bg` | vert (hors charte, voir note) | Badge de succès (ex: VALIDEE) |

**Note accessibilité (WCAG AA, 4.5:1 minimum) :** les couleurs officielles
`sim-red` et `sim-orange` n'atteignent que 4.02:1 et 3.15:1 avec du texte
blanc, et `sim-blue-light` seulement 2.47:1 — toutes en dessous du seuil
AA. Les tokens sémantiques (`danger`, `warning`, `info`) utilisent donc une
teinte assombrie de la même couleur (même teinte/saturation, luminosité
réduite) qui passe AA (`danger` 5.27:1, `warning` 6.66:1, `info` >4.5:1),
sans changer l'identité perçue. `sim-yellow` (Santé) n'a pas d'équivalent
sémantique : à 1.17:1 avec du blanc et illisible même en texte sombre sur
fond clair, elle ne doit être utilisée qu'en aplat avec du texte très
sombre — pas encore intégrée à un composant, à traiter au cas par cas si
un usage apparaît. Il n'existe pas de couleur "succès" dans la charte :
`success` reste un vert sobre choisi indépendamment, sans conflit avec les
couleurs officielles.

### Typographie

**Montserrat** est la police institutionnelle (titres et communication),
chargée via `next/font/google` dans
[src/app/layout.tsx](src/app/layout.tsx) et appliquée par défaut à tout le
projet (`font-sans`). Poids chargés : `font-normal` (400, texte courant),
`font-bold` (700, titres de section), `font-black` (900, gros titres). Ne
pas importer d'autre police pour du texte ou des titres.

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

### Logo

[public/logo-sim-blanc.webp](public/logo-sim-blanc.webp) est la version
**blanche** du logo — à utiliser exclusivement sur fond foncé (typiquement
`bg-primary`, le bleu institutionnel). Utilisée dans l'en-tête du Socle
Portail ([src/app/(dashboard)/layout.tsx](<src/app/(dashboard)/layout.tsx>)).
Une version couleur pour fond clair sera fournie plus tard — ne pas poser
la version blanche sur un fond clair en attendant (illisible).

Respecter une zone de protection minimale autour du logo : aucun élément
(texte, icône, bordure) ne doit toucher ses bords. Dans l'en-tête existant,
cet espace est garanti par le padding du conteneur — reproduire le même
principe pour tout nouvel emplacement du logo plutôt que de le coller à un
bord ou à un autre élément.

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
(route `/ui-preview`, accessible sans connexion) affiche la palette
officielle, les graisses Montserrat, et tous les composants de
`src/components/ui` avec des exemples d'usage réels : variantes de Button,
Badges de statut, DataTable triable, déclenchement de toasts, et un
formulaire complet Server Action + zod + gestion d'erreurs par champ.

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

## Module Pointage RH : fondations de données et parcours QR
## Refonte V1 en cours

Le cahier des charges du Module Trésorerie a été **entièrement réécrit**
par le maître de stage (document "CAHIER DES CHARGES — V1"). Les tickets
1 à 10 documentés ci-dessous restent la trace de **comment** le module a
été construit (patterns, pièges, décisions techniques toujours valables),
mais leur description **fonctionnelle** ne reflète plus exactement les
règles métier actuelles sur plusieurs points — voir cette section avant
de s'y fier pour le comportement attendu.

**Étape actuelle : fondations de données uniquement.** Le schéma et les
mappings minimaux nécessaires à la compilation sont en place ; la vraie
logique métier des nouveaux concepts (validation partielle, règlement
adapté, fonds remis détaillés, bon de caisse, dashboard enrichi) sera
reprise phase par phase (B à H), une par une, avec le maître de stage.

### Changements structurels actés dans le schéma (fait)

- **Catégorie/Objet/Budget disparaissent du cahier des charges.** Les
  modèles `Categorie`/`Objet`, le CRUD `admin/categories`, l'écran de
  catégorisation Finance (`CategorisationForm`), le regroupement et les
  filtres du reporting/export (Ticket 10), et l'affichage catégorie/objet
  sur le reçu PDF (Ticket 9) **restent tous en place et fonctionnels**,
  volontairement non touchés à cette étape (portée choisie explicitement
  avec l'utilisateur : nettoyage complet différé aux phases B-H, pour ne
  pas défricher un écran dont la vraie logique de remplacement n'est pas
  encore spécifiée). `categorieId`/`objetId`/`budgetDisponible` restent en
  base sur `Demande`, nullables, non requis par le flux principal.
- **`Demande.montantValide`** (Decimal, nullable) — cumul du montant
  validé à date, distinct de `montant` (montant demandé). Alimenté pour la
  première fois par `validerDemandeAction` (mise à hauteur du montant
  demandé en entier — voir mapping temporaire ci-dessous).
- **Bénéficiaire distinct du Demandeur** — `Demande.beneficiaireType`
  (enum `BeneficiaireType` : `COLLABORATEUR`/`STAGIAIRE`/`FOURNISSEUR`/
  `ENTREPRISE`), `beneficiaireUserId` (relation `User` optionnelle,
  uniquement si collaborateur/stagiaire avec un compte) et
  `beneficiaireNom` (texte libre sinon, y compris "SIM ASSURANCES CI").
- **`StatutDemande`** passe de 5 à 11 valeurs : `BROUILLON`,
  `EN_ATTENTE_VALIDATION`, `VALIDEE`, `PARTIELLEMENT_VALIDEE`,
  `VALIDEE_NON_REGLEE`, `PARTIELLEMENT_REGLEE`, `REGLEE`, `REJETEE`,
  `EN_ATTENTE_REGULARISATION`, `REGULARISEE`, `CLOTUREE`. Migration
  `refonte_v1_demande_beneficiaire_statut`.

### Mappings temporaires effectués pour recompiler (à reprendre phase par phase)

La logique applicative existante (Tickets 1 à 10) ne produit et ne
comprend encore que les 4 statuts qu'elle connaissait avant la refonte,
translittérés vers les nouvelles valeurs les plus proches :
`EN_ATTENTE -> EN_ATTENTE_VALIDATION`, `VALIDEE` inchangé, `REJETEE`
inchangé, `CLOTUREE_TOTALE`/`CLOTUREE_PARTIELLE -> CLOTUREE` (fusionnés).
Aucun code ne produit encore `BROUILLON`, `PARTIELLEMENT_VALIDEE`,
`VALIDEE_NON_REGLEE`, `PARTIELLEMENT_REGLEE`, `REGLEE`,
`EN_ATTENTE_REGULARISATION` ni `REGULARISEE` — posés en fondation pour les
phases à venir. Endroits précis à revisiter :

- [demandeStatut.ts](src/components/tresorerie/demandeStatut.ts) —
  `STATUT_DEMANDE_BADGE_VARIANT`/`STATUT_DEMANDE_LABEL` couvrent les 11
  valeurs (exigé par `Record<StatutDemande, ...>`), mais le variant/libellé
  des 7 statuts encore inutilisés est provisoire — à revoir quand chaque
  phase commencera à les produire réellement.
- [treso/demandes/nouvelle/actions.ts](<src/app/(dashboard)/treso/demandes/nouvelle/actions.ts>)
  — `creerDemandeAction` fixe `beneficiaireType: "COLLABORATEUR"` et
  `beneficiaireUserId: session.user.id` par défaut : **aucune UI n'existe
  encore** pour choisir un bénéficiaire différent du créateur
  (collaborateur tiers, stagiaire, fournisseur, ou l'entreprise). À
  construire dans une phase dédiée.
- [treso/finance/demandes/[id]/actions.ts](<src/app/(dashboard)/treso/finance/demandes/[id]/actions.ts>)
  — `categoriserDemandeAction`/`validerDemandeAction`/`rejeterDemandeAction`
  revérifient `statut !== "EN_ATTENTE_VALIDATION"` (au lieu de
  `EN_ATTENTE`) ; `validerDemandeAction` valide toujours le **montant
  entier** (`montantValide = demande.montant`) — pas encore de validation
  partielle ni de validation complémentaire sur un reliquat ;
  `cloturerDemandeAction` écrit toujours `statut: "CLOTUREE"` quel que soit
  `type` (`"TOTALE"`/`"PARTIELLE"`, toujours accepté en paramètre, motif
  toujours obligatoire pour `"PARTIELLE"`) — la distinction totale/partielle
  n'existe plus dans le statut lui-même, seulement dans `motifCloture`.
  **Superseded par la Phase B ci-dessous** : `validerDemandeAction` a été
  remplacée par `validerTotalementAction`/`validerPartiellementAction`/
  `validerComplementaireAction` — ce paragraphe reste pour l'historique de
  la Phase A, voir la section Phase B pour l'état actuel.
- [treso/finance/demandes/[id]/page.tsx](<src/app/(dashboard)/treso/finance/demandes/[id]/page.tsx>)
  et [treso/demandes/[id]/page.tsx](<src/app/(dashboard)/treso/demandes/[id]/page.tsx>)
  — branches de rendu sur `"EN_ATTENTE_VALIDATION"`/`"CLOTUREE"` ; l'affichage
  du motif de clôture n'est plus conditionné à un ancien statut partiel
  (affiché dès que `motifCloture` est non nul).
- [treso/finance/demandes/page.tsx](<src/app/(dashboard)/treso/finance/demandes/page.tsx>)
  — filtre `findMany` sur `EN_ATTENTE_VALIDATION`.
- [reporting.ts](src/lib/reporting.ts) — whitelist de `parseReportingFilters`
  mise à jour aux 11 valeurs ; `STATUTS_VALIDES` devient
  `["VALIDEE", "CLOTUREE"]`. Le regroupement Catégorie/Objet du reporting
  lui-même n'a pas été retouché (voir ci-dessus).
- [ReportingFiltersForm.tsx](<src/app/(dashboard)/treso/finance/reporting/ReportingFiltersForm.tsx>)
  — `STATUT_OPTIONS` aligné (`EN_ATTENTE_VALIDATION`, `CLOTUREE` unique).

**Seed (`prisma/seed.ts`) non modifié pour le bénéficiaire** — vérifié
explicitement : le seed actuel ne crée **aucune** `Demande` de test (seuls
rôles/permissions/utilisateurs/catégories/objets/paramétrage horaire sont
semés), donc aucune donnée de démonstration n'avait besoin d'un
bénéficiaire cohérent à cette étape. À faire le jour où des demandes de
test seront ajoutées au seed.

### Vérifié explicitement (fondations)

`npx prisma migrate dev` (migration `refonte_v1_demande_beneficiaire_statut`)
et `npx prisma db seed` ont réellement été exécutés contre la base de dev,
`npx tsc --noEmit` et `npx eslint .` passent sans erreur, `npm run dev`
démarre et `GET /login` répond 200.

## Phase B — Validation partielle et complémentaire (terminée)

Implémente la section 3 du nouveau cahier des charges : un validateur
(`treso.valider_demande`, Finance et DG) peut désormais valider
**totalement**, valider **partiellement** (montant inférieur au montant
demandé), ou **rejeter** une demande `EN_ATTENTE_VALIDATION` ; une demande
`PARTIELLEMENT_VALIDEE` peut ensuite recevoir une ou plusieurs
**validations complémentaires** sur le reliquat, jusqu'à couvrir
entièrement le montant demandé.

### `calculerStatutDemande` — fonction centrale du statut

[src/lib/tresorerie.ts](src/lib/tresorerie.ts) exporte
`calculerStatutDemande(demandeId)` : lit les montants réels de la demande
(`montant`, `montantValide`, `getTotalRegle`), déduit le statut correct et
l'enregistre en base. **Aucune Server Action ne fixe plus `statut` à la
main pour les transitions qu'elle couvre** — chacune appelle cette fonction
à sa toute fin (`validerTotalementAction`, `validerPartiellementAction`,
`validerComplementaireAction`, via l'helper interne partagé
`enregistrerValidation`).

Interprétation retenue (le cahier des charges laisse une marge sur
l'articulation exacte de ces statuts — documentée en détail dans le
docstring de la fonction) :

| Condition | Statut déduit |
|---|---|
| `statut` actuel est `REJETEE` ou `CLOTUREE` | inchangé (états terminaux, gérés par leurs propres actions) |
| `montantValide` nul ou 0 | `EN_ATTENTE_VALIDATION` |
| `0 < montantValide < montant demandé` | `PARTIELLEMENT_VALIDEE` |
| `montantValide === montant demandé`, et `getTotalRegle() === 0` | `VALIDEE_NON_REGLEE` |
| `montantValide === montant demandé`, et `0 < réglé < montantValide` | `PARTIELLEMENT_REGLEE` |
| `montantValide === montant demandé`, et `réglé >= montantValide` | `REGLEE` |

**Conséquence importante : le statut `VALIDEE` n'est plus jamais produit**
par cette fonction — une validation totale (en une fois ou par
validations complémentaires successives) transite directement vers
`VALIDEE_NON_REGLEE` dès que `calculerStatutDemande` tourne (le règlement
n'existe pas encore au moment de la validation). `VALIDEE` reste dans
l'enum et dans `STATUTS_VALIDATION_COMPLETE` (voir ci-dessous) uniquement
pour compatibilité/historique. Les comparaisons de montants utilisent des
centimes entiers (`Math.round(montant * 100)`) plutôt que l'égalité directe
sur des `Number` flottants, pour éviter tout artefact de virgule flottante
sur une égalité stricte (`montantValide === montant demandé`).

### Compatibilité avec les Tickets 4 à 8 et 10 (`STATUTS_VALIDATION_COMPLETE`)

Les Tickets 4 (règlement), 5/6 (retour de caisse), 7 (clôture), 8 (dashboard
Finance) et 10 (reporting) ont tous été écrits contre l'ancien statut
unique `VALIDEE`. Comme la validation totale ne produit plus ce statut
(voir ci-dessus), **toutes leurs gardes de statut ont dû être élargies**
pour continuer à fonctionner sans régression — pas juste les Server
Actions de validation demandées explicitement. `STATUTS_VALIDATION_COMPLETE`
(`src/lib/tresorerie.ts`) = `["VALIDEE", "VALIDEE_NON_REGLEE",
"PARTIELLEMENT_REGLEE", "REGLEE"]`, substitué à chaque `statut === "VALIDEE"`
/`statut !== "VALIDEE"` dans :

- `reglementActions.ts` (création, modification, confirmation, annulation
  d'un règlement — 4 gardes).
- `retourActions.ts` côté Finance (réception d'un retour) et côté
  Collaborateur (déclaration d'un retour).
- `dashboardFinance.ts` (`RETOUR_EN_ATTENTE_WHERE`,
  `getRepartitionDemandesValidees`) et les listes filtrées
  `a-decaisser`/`a-regulariser` (Ticket 8).
- `reporting.ts` (`STATUTS_VALIDES`, colonne "Validé").
- `cloturerDemandeAction` (Ticket 7).
- `treso/demandes/[id]/page.tsx` (bouton "Déclarer un retour de caisse").

Ces écrans eux-mêmes (montants basés sur `montant demandé`, pas encore sur
`montantValide`) **n'ont pas été réécrits** — seul leur point d'entrée
(garde de statut) est élargi. Cela reste exact tant qu'ils ne sont
atteignables que via ces 4 statuts, qui impliquent tous
`montantValide === montant demandé` par construction : une demande
seulement `PARTIELLEMENT_VALIDEE` reste hors de cet ensemble, donc aucun
règlement/retour/clôture n'est possible dessus avant que son reliquat soit
validé (ou une validation complémentaire ultérieure). L'adaptation réelle
de ces écrans à un montant réglable potentiellement inférieur au montant
demandé (via `montantValide`) est le périmètre de la phase "règlement
adapté", pas de celle-ci.

### Nouvelles Server Actions (`treso/finance/demandes/[id]/actions.ts`)

- **`validerTotalementAction(demandeId)`** — `montantValide` = montant
  demandé, en une fois. Réservée à `EN_ATTENTE_VALIDATION`.
- **`validerPartiellementAction(demandeId, montant)`** — réservée à
  `EN_ATTENTE_VALIDATION`. Règle impérative : un montant strictement
  supérieur au montant demandé est **refusé** côté serveur (jamais
  plafonné silencieusement). Cas limite : un montant exactement égal au
  montant demandé est accepté et appliqué comme une validation totale
  (évite un aller-retour inutile entre les deux boutons pour ce cas précis
  — ce n'est plus une validation "partielle" au sens strict).
- **`validerComplementaireAction(demandeId, montant)`** — réservée à
  `PARTIELLEMENT_VALIDEE`. Le montant ne peut jamais faire dépasser le
  montant demandé une fois ajouté à `montantValide` existant (refusé côté
  serveur si c'est le cas) ; aucune restriction sur l'auteur (le même
  validateur ou un autre habilité peut l'exécuter).
- Les trois partagent l'helper interne `enregistrerValidation` : met à jour
  `montantValide`, crée une `HistoriqueEntry` (`action: "validation"` ou
  `"validation_complementaire"`, `detail` incluant le montant validé à
  cette étape précise ET le cumul), puis appelle `calculerStatutDemande`.
- **`rejeterDemandeAction`** — inchangée dans son fonctionnement (motif
  obligatoire, min 3 caractères), mais **reste réservée à
  `EN_ATTENTE_VALIDATION`** : une demande déjà `PARTIELLEMENT_VALIDEE` ne
  peut plus être rejetée. Choix documenté : une fois qu'un montant a été
  validé (et potentiellement déjà réglé/retourné dans le circuit), revenir
  en arrière sur la totalité de la demande n'a plus de sens — le montant
  déjà validé est acquis. Le seul chemin en avant pour le reliquat est une
  validation complémentaire. **Aucune action de "rejet du reliquat"
  n'existe à ce stade** : si un validateur veut abandonner la partie non
  encore validée d'une demande `PARTIELLEMENT_VALIDEE`, ce cas reste sans
  réponse applicative — à traiter explicitement dans une phase ultérieure
  (clôture/régularisation) plutôt que résolu par un raccourci ici.
- `cloturerDemandeAction` — sa garde de statut est élargie à
  `STATUTS_VALIDATION_COMPLETE` (voir ci-dessus) ; elle-même n'appelle pas
  `calculerStatutDemande` (écrit toujours `CLOTUREE` explicitement, état
  terminal que la fonction ne modifierait de toute façon jamais).

### Interface (Finance/DG)

`treso/finance/demandes/[id]/page.tsx` affiche désormais, en plus du
montant demandé et du statut : **Montant validé** et **Montant restant à
valider**, sur cette page ET sur `treso/demandes/[id]/page.tsx`
(Collaborateur) — visible partout où le statut de validation est affiché
(règle impérative 6). Trois branches de rendu :

- `EN_ATTENTE_VALIDATION` → `ValidationActions` (nouveau : boutons "Valider
  totalement" / "Valider partiellement" avec saisie de montant / "Rejeter"
  avec motif — remplace l'ancien bouton "Valider" unique du Ticket 3).
- `PARTIELLEMENT_VALIDEE` → résumé catégorisation verrouillé (lecture
  seule) + `ValidationComplementaireActions` (nouveau composant) si
  `canValider` : saisie plafonnée côté client au reliquat, revalidée côté
  serveur.
- Statut ∈ `STATUTS_VALIDATION_COMPLETE` → inchangé (règlement, clôture).

L'historique générique (`DemandeHistorique`) affiche chaque validation
(initiale ou complémentaire) comme une entrée distincte avec son propre
montant, sans modification du composant — `validation_complementaire`
ajouté à `ACTION_LABELS`.

### Vérifié explicitement (Phase B)

`npx tsc --noEmit` et `npx eslint .` passent sans erreur. Script de
vérification exécuté directement contre la base de dev (créant puis
nettoyant ses propres demandes de test, via les vraies fonctions
`calculerStatutDemande`/`getTotalRegle` et en reproduisant exactement les
écritures Prisma des Server Actions — celles-ci n'ont pas pu être invoquées
directement hors requête Next.js, `getSession()` dépendant de
`next/headers`) :

- Demande de 100 000 FCFA validée totalement → `VALIDEE_NON_REGLEE`,
  `montantValide = 100 000`.
- Demande de 400 000 FCFA validée partiellement à 250 000 →
  `PARTIELLEMENT_VALIDEE`, montant restant à valider = 150 000 ; validation
  complémentaire de 150 000 → `VALIDEE_NON_REGLEE`, `montantValide = 400 000`.
  Deux `HistoriqueEntry` distinctes créées, chacune avec le bon montant
  ("250000" puis "150000" dans leur `detail` respectif).
- Validation partielle de 150 000 sur une demande de 100 000 : détectée et
  refusée par le garde-fou serveur (`montantValide` reste `null`, aucune
  écriture).
- Validation complémentaire de 200 000 sur un reliquat de 150 000 (demande
  de 400 000 déjà validée à 250 000) : détectée et refusée (`montantValide`
  reste à 250 000, aucune écriture supplémentaire).

Toutes les données de test nettoyées après vérification (0 demande
restante, les 5 comptes de test intacts). **Aucun test fonctionnel du
règlement/retour/clôture n'a été mené** (hors périmètre de cette phase) :
ces écrans restent dans l'état transitoire décrit ci-dessus tant que la
phase "règlement adapté" n'a pas repris leur logique.

## Phase C — Règlement adapté à la validation partielle (terminée)

Adapte le Règlement (Ticket 4) et le Retour de caisse (Tickets 5/6) au
modèle de validation partielle posé en Phase B, en corrigeant une
restriction introduite par erreur à la Phase B elle-même.

### Correction du périmètre de la Phase B

Cahier des charges, section 4 : *"Montant demandé : 400 000 FCFA. Montant
validé : 250 000 FCFA. Premier règlement : 200 000 FCFA. Solde validé
restant à régler : 50 000 FCFA. Les 50 000 FCFA peuvent être réglés
ultérieurement sans nouvelle validation."* Une demande `PARTIELLEMENT_VALIDEE`
est donc réglable **immédiatement** sur la base du montant déjà validé,
sans attendre que le reliquat soit validé à son tour.

`STATUTS_VALIDATION_COMPLETE` (posé en Phase B pour la compatibilité des
Tickets 4-8-10 avec le nouveau `calculerStatutDemande`) excluait à tort
`PARTIELLEMENT_VALIDEE` de l'éligibilité au règlement — trop restrictif et
contraire à cet exemple. Cette phase corrige ce point partout où il
s'appliquait à tort (règlement, retour de caisse, dashboard, listes) ; il
reste utilisé, lui, pour l'éligibilité à la **clôture** (Ticket 7, hors
périmètre de cette phase — la clôture continue de n'être possible qu'une
fois le montant demandé *entièrement* validé).

### `getResteARegler` — nouvelle base de calcul

[src/lib/tresorerie.ts](src/lib/tresorerie.ts) : la base devient
**`montantValide`**, plus le montant demandé. `null` (aucune validation) →
0 (rien n'est réglable). Formule : `max(0, montantValide - getTotalRegle())`.

### `peutEffectuerReglement` — nouvelle fonction d'éligibilité

Remplace `STATUTS_VALIDATION_COMPLETE` pour l'éligibilité au règlement :
`montantValide > 0` **ET** `getResteARegler() > 0`, **ET** la demande n'est
ni `REJETEE` ni `CLOTUREE` (ce dernier verrou est nécessaire : une demande
clôturée avec un écart non résolu — clôture partielle, Ticket 7 — peut
avoir un reste > 0 sans qu'aucune action de règlement ne doive redevenir
possible dessus ; le calcul sur les seuls montants ne suffit pas à couvrir
ce cas). Utilisée par `creerReglementAction`, `modifierReglementAction` et
`confirmerReglementAction`.

**Cas particulier volontaire : `annulerReglementAction` n'utilise PAS
`peutEffectuerReglement`.** Cette garde exigerait un reste à régler > 0
*avant* l'annulation, ce qui bloquerait à tort l'annulation du tout dernier
règlement d'une demande `REGLEE` (reste = 0 par définition) — l'annulation
est précisément le mécanisme qui doit pouvoir faire repasser le reste
au-dessus de 0. Elle utilise donc un contrôle plus simple : la demande ne
doit être ni `CLOTUREE` ni `REJETEE`.

### Recalcul du statut après règlement (Tâche 3)

`confirmerReglementAction` et `annulerReglementAction` appellent désormais
`calculerStatutDemande(demandeId)` (fonction centrale, Phase B) en fin
d'action, au lieu d'une logique de statut ad hoc. Le comportement dépend
de l'état de validation :

- Si la demande est `PARTIELLEMENT_VALIDEE` (montant demandé pas encore
  entièrement validé) : le statut **reste `PARTIELLEMENT_VALIDEE`**, quel
  que soit l'avancement du règlement sur la part déjà validée — c'est
  `calculerStatutDemande` qui l'impose (la branche "validation partielle"
  est prioritaire sur la branche "règlement", voir Phase B). Le règlement
  progresse "silencieusement" en arrière-plan (visible dans la section
  Règlements — reste à régler, liste des règlements confirmés) sans que le
  badge de statut ne change, tant que le reliquat n'est pas validé.
- Une fois le montant demandé entièrement validé (validation totale, ou
  validations partielle + complémentaire(s) cumulées) : `VALIDEE_NON_REGLEE`
  / `PARTIELLEMENT_REGLEE` / `REGLEE` selon `getTotalRegle`, comme déjà
  posé en Phase B.

### Retour de caisse (Ticket 5/6) — même correction (Tâche 4)

`retourActions.ts` (déclaration, Collaborateur) et
`retourActions.ts` (réception, Finance) dépendaient eux aussi de
`STATUTS_VALIDATION_COMPLETE`, bloquant à tort la déclaration/réception
d'un retour lié à un règlement confirmé sur une demande seulement
`PARTIELLEMENT_VALIDEE`. Corrigé : ce qui conditionne réellement ces deux
actions, c'est l'état du **règlement précis concerné** (mode `CAISSE`,
confirmé, non annulé — déjà vérifié indépendamment du statut de la
demande), pas le statut global de validation. Seule la clôture
(`demande.statut === "CLOTUREE"`) doit encore bloquer.

### Dashboard Finance et listes (Ticket 8, Tâche 5)

[src/lib/dashboardFinance.ts](src/lib/dashboardFinance.ts),
`a-decaisser/page.tsx` et `a-regulariser/page.tsx` : sélection et calcul du
reste basés sur `montantValide` (`{ gt: 0 }`), plus l'exclusion explicite
de `REJETEE`/`CLOTUREE` — une demande `PARTIELLEMENT_VALIDEE` apparaît donc
dans "Demandes à décaisser" dès que son montant validé dépasse ce qui est
déjà réglé.

**Distinction ajoutée pour "Décaissements à régulariser"** (pas
explicitement demandée mais nécessaire pour rester cohérent) : cette liste
exige en plus que le montant demandé soit **entièrement** validé
(`montantValide >= montant`). Sans cette condition, une demande
`PARTIELLEMENT_VALIDEE` dont la part déjà validée est intégralement réglée
(reste = 0 sur ces 250 000, par exemple) serait apparue comme "prête pour
la clôture" alors qu'un reliquat reste à valider et pourrait ensuite être
réglé à son tour. Une telle demande n'apparaît donc, à ce stade, dans
**aucune des deux listes** — état transitoire correct, ni actionnable
("rien à décaisser dans l'immédiat") ni clôturable.

### Renommages de props (clarté, sans changement de comportement)

`ReglementsSection`/`RegularisationSummary` : la prop `montantDemande`
devient `montantValide` (elle affichait déjà le libellé "Montant validé" —
Phase A/B avaient changé le contenu affiché sans renommer la prop). Tous
les appelants mis à jour ( `treso/finance/demandes/[id]/page.tsx`,
`treso/demandes/[id]/page.tsx`).

### Interface (Finance/DG)

`treso/finance/demandes/[id]/page.tsx` : les branches `PARTIELLEMENT_VALIDEE`
et "montant entièrement validé" (`STATUTS_VALIDATION_COMPLETE`) sont
regroupées en une seule branche de rendu (`demande.montantValide != null &&
Number(demande.montantValide) > 0`) : `ReglementsSection` s'affiche dans
les deux cas désormais, `ValidationComplementaireActions` uniquement si
`PARTIELLEMENT_VALIDEE`, `ClotureActions` uniquement si
`STATUTS_VALIDATION_COMPLETE.includes(statut)`.

### Vérifié explicitement (Phase C) — parcours utilisateur réel dans le navigateur

**Fait par de vraies actions utilisateur pilotées par un navigateur Chromium
headless (Playwright), PAS par un script isolé appelant les fonctions
serveur directement** — contrairement à la Phase B (où `getSession()`
dépend de `next/headers`, indisponible hors requête Next.js réelle). Ici,
le serveur `next dev` tournait réellement et chaque étape a été exécutée en
remplissant les vrais formulaires et en cliquant les vrais boutons de
l'interface, exactement comme un utilisateur — pas de contournement de
l'authentification ni des Server Actions.

Playwright n'est pas une dépendance du projet (pas ajoutée à
`package.json`) : exécutée depuis le cache npx local existant sur la
machine, aucune trace laissée dans les fichiers du projet.

Parcours reproduit (comptes réels `collaborateur@simassurances.test` /
`finance@simassurances.test`), reproduisant exactement l'exemple du cahier
des charges section 4 puis le prolongeant :

1. Collaborateur crée une demande de 400 000 FCFA.
2. Finance valide **partiellement** 250 000 FCFA → statut
   `Partiellement validée`, montant restant à valider affiché = 150 000 FCFA.
3. Finance confirme un règlement Caisse de 200 000 FCFA **sans attendre de
   validation complémentaire** (point clé de cette phase — vérifié que ça
   fonctionne) → reste à régler = 50 000 FCFA, montant restant à valider
   toujours 150 000 FCFA (inchangé), statut toujours `Partiellement
   validée`, bouton de validation complémentaire toujours disponible.
4. Règlement Banque des 50 000 FCFA restants → reste à régler = 0 FCFA,
   statut toujours `Partiellement validée` (150 000 FCFA restent à
   valider), formulaire d'ajout de règlement disparu.
5. Validation complémentaire des 150 000 FCFA restants → montant validé =
   400 000 FCFA, montant restant à valider = 0, statut `Partiellement
   réglée`, reste à régler recalculé = 150 000 FCFA (400 000 - 250 000),
   formulaire de règlement réapparu.
6. Règlement Caisse final des 150 000 FCFA → reste à régler = 0, statut
   final `Réglée`.
7. Le compte `collaborateur@simassurances.test` (aucune des 5 permissions
   de `treso/finance/layout.tsx`) tentant d'accéder directement à
   `/treso/finance/demandes/{id}` est bien redirigé vers
   `/?error=acces_refuse_categoriser`.

`npx tsc --noEmit` et `npx eslint .` passent sans erreur. Données de test
nettoyées après coup (suppression directe en base de la demande créée par
le parcours — aucune fonctionnalité de suppression n'existe dans
l'application, comme pour les tickets précédents) ; la base ne contient
plus qu'une demande préexistante sans rapport avec cette vérification,
non créée par cette session et volontairement non touchée. Serveur `next
dev` arrêté après vérification.

## Phase D — Fonds remis : lignes de dépenses détaillées (terminée)

Restructure la déclaration de retour de caisse (Tickets 5/6) selon les
sections 8-9 du cahier des charges : un `RetourCaisse` ne stocke plus un
montant dépensé agrégé unique avec une seule justification, mais une liste
de `DepenseLigne` détaillées (une par dépense réelle).

### Choix documenté : `montantARetourner` CALCULÉ, jamais saisi

Le cahier des charges est en tension entre deux phrases : la section 9.3
dit que l'utilisateur "enregistre" un montant à retourner (suggérant une
saisie), la section 9.5 dit explicitement "le solde ne doit pas être
modifiable manuellement". **Tranché en faveur du calcul automatique** :
`montantARetourner` = montant du règlement lié moins la somme des
`DepenseLigne` déclarées (`getMontantARetourner`, `src/lib/tresorerie.ts`),
jamais reçu du formulaire ni de la Server Action en paramètre. Cohérent
avec le principe déjà appliqué ailleurs dans le projet : `getSoldeCaisse()`
(Ticket 4) est également toujours recalculé à partir du grand livre, jamais
saisi — aucun solde financier ne doit être modifiable à la main. Le
formulaire de déclaration affiche ce montant en LECTURE SEULE (aperçu
calculé côté client, recalculé côté serveur — l'aperçu client n'est jamais
la source de vérité).

### Modèle `DepenseLigne`

Nouveau modèle (migration `phase_d_depense_ligne`) : `montant`, `objet`,
`date`, `nature` (texte libre optionnel), `justification`
(`TypeJustification`, comme avant), `commentaire` (obligatoire si
`justification = SANS_PIECE`, même règle que le Ticket 5). `RetourCaisse`
perd `montantDepense`/`justification`/`commentaire` (remplacés par la
relation `depenses DepenseLigne[]`), garde `montantARetourner` (désormais
calculé, voir ci-dessus) et `estReceptionne`. Aucune donnée de seed à
adapter : `prisma/seed.ts` ne crée aucun `RetourCaisse` (vérifié).

### Nouvelles fonctions de calcul (`src/lib/tresorerie.ts`)

- `getTotalDepensesDeclarees(retourCaisseId)` — somme des `DepenseLigne`
  d'un retour précis.
- `getMontantNonJustifie(retourCaisseId)` — somme des lignes
  `justification = SANS_PIECE` d'un retour précis (mise en évidence à
  l'affichage, Tâche 5).
- `getMontantARetourner(retourCaisseId)` — montant du règlement lié moins
  `getTotalDepensesDeclarees`, jamais négatif. Utilisée à la création du
  retour (`creerRetourCaisseAction`), jamais recalculée ensuite (les
  dépenses sont figées une fois le retour déclaré — V1 volontairement
  simple, pas d'édition de dépenses après coup).
- `getSoldeARegulariser(reglementId)` — montant du règlement moins les
  dépenses déclarées (toutes les `DepenseLigne` de tous les retours liés à
  CE règlement) moins les retours effectivement reçus (`montantARetourner`
  des retours `estReceptionne: true`). **Doit valoir 0 une fois que tout
  est correctement justifié et/ou retourné** — équivalent de `getEcart`
  (Ticket 7) mais à l'échelle d'un règlement précis plutôt que d'une
  demande entière (une demande peut avoir plusieurs règlements Caisse,
  chacun son propre cycle fonds remis). Vérifié explicitement (voir plus
  bas) : 0 après un cycle complet déclaration + réception.
- `getDepensesDeclarees(demandeId)` (Ticket 7, déjà existante) adaptée pour
  sommer les `DepenseLigne` via la relation imbriquée
  `retourCaisse.reglement.demandeId`, au lieu de l'ancien
  `retourCaisse.montantDepense`.

### Formulaire de déclaration reconstruit (`RetourCaisseForm.tsx`)

Remplace le formulaire à un seul montant (Ticket 5, `<form action=
{formAction}>` + `useActionState`/`FormData`) par une liste dynamique de
lignes gérée en état local React (`useState<LigneEdit[]>`, "Ajouter une
ligne de dépense" / "Retirer" par ligne, au moins une ligne obligatoire).
Un tableau de lignes ne se prête pas nativement à `FormData` : le
formulaire appelle donc directement `creerRetourCaisseAction(reglementId,
lignes)` (arguments simples + `useTransition`), même pattern que
`validerComplementaireAction`/`confirmerReglementAction` plutôt que le
pattern `useActionState` du Ticket 5.

**Piège Select évité** (déjà documenté au Ticket 2) : le champ
"Justification" de chaque ligne utilise `defaultValue`, jamais `value` —
`Select` fixe déjà `defaultValue` en interne, et chaque ligne a une `key`
stable pour sa durée de vie, donc pas besoin de la remonter pour refléter
un changement programmatique.

Total déclaré et montant à retourner recalculés à chaque frappe et
affichés en lecture seule (aperçu — la Server Action revalide et calcule
la valeur définitive côté serveur).

### Server Action reconstruite (`creerRetourCaisseAction`)

Signature changée : `(reglementId, lignes: LigneDepenseInput[])` au lieu de
`(prevState, formData)`. Dans une seule transaction (`prisma.$transaction`
avec callback, pas un tableau d'opérations — nécessaire ici car l'id du
`RetourCaisse` créé doit être réutilisé pour `depenseLigne.createMany`) :
crée le `RetourCaisse` (`montantARetourner` calculé), crée toutes les
`DepenseLigne` (`createMany`), crée l'entrée `HistoriqueEntry` (résumé :
nombre de lignes, total déclaré, montant à retourner calculé). Contrôles
d'éligibilité inchangés (permission, règlement Caisse confirmé non annulé,
demande non `CLOTUREE`, propriété de la demande, un seul retour par
règlement).

### Affichage mis à jour (Tâche 5)

- `RetourCaisseRow` (Collaborateur) : nouveau sous-composant
  `DetailDepenses` — liste chaque ligne (objet, montant, date,
  justification, nature, commentaire), puis un résumé (total déclaré, à
  retourner, **non justifié en `text-warning`** si > 0 — couleur d'alerte
  de la charte, cohérente avec le reste du projet : reste à régler,
  écart de régularisation).
- `RetoursEnAttenteTable` (Finance, Ticket 6) : colonnes
  "Montant dépensé"/"Justification"/"Commentaire" remplacées par "Détail
  des dépenses" (liste compacte par ligne), "Total déclaré" et
  "Non justifié" (même mise en évidence `text-warning`).
- Reporting (Ticket 10) et son export Excel : feuille "Retours de caisse"
  adaptée (`montantDepenseTotal`/`montantNonJustifie` remplacent
  `montantDepense`/`justification`, agrégés en mémoire depuis les
  `DepenseLigne` incluses — même convention que le reste du reporting).

### Réception (Ticket 6) — vérifiée inchangée (Tâche 6)

`receptionnerRetourAction` lit `retour.montantARetourner` directement (même
colonne qu'avant) : aucune modification nécessaire, seule la façon dont ce
champ est rempli à la création a changé (calcul plutôt que saisie).
Structurellement identique : écriture `JournalCaisse` `ENTREE` du montant,
marquage `estReceptionne`, dans la même transaction.

### Vérifié explicitement (Phase D) — vrai parcours navigateur

Même méthode que la Phase C : Chromium headless piloté par Playwright
(non ajouté au projet) contre le vrai serveur `next dev`, formulaires
réellement remplis et boutons réellement cliqués avec les comptes
`collaborateur@`/`finance@simassurances.test`.

1. Règlement Caisse de 100 000 FCFA confirmé (demande validée totalement).
2. Déclaration d'un retour avec 3 lignes : 40 000 FCFA (Facture), 30 000
   FCFA (Reçu), 10 000 FCFA (Sans pièce, commentaire obligatoire renseigné).
3. Aperçu client (avant soumission) : total déclaré = 80 000 FCFA, montant
   à retourner = 20 000 FCFA — conforme.
4. Après déclaration : détail des 3 lignes affiché, total déclaré 80 000
   FCFA, à retourner 20 000 FCFA, **non justifié 10 000 FCFA** mis en
   évidence.
5. Liste Finance "Retours en attente" : mêmes montants affichés.
6. Réception du retour côté Finance.
7. Contrôle direct en base (après le parcours navigateur, sur les données
   qu'il a produites) : `retour.estReceptionne = true`,
   `montantARetourner = 20000` en base, écriture `JournalCaisse` `ENTREE`
   de 20 000 FCFA (`source: "retour_caisse_receptionne"`), **`getSoldeARegulariser(reglementId) = 0`**
   (100 000 − 80 000 déclarés − 20 000 reçus), solde de caisse global
   cohérent (−80 000 FCFA après ce cycle : −100 000 SORTIE + 20 000 ENTREE).

`npx tsc --noEmit` et `npx eslint .` passent sans erreur. Données de test
nettoyées après coup ; la base ne contient plus que la même demande
préexistante sans rapport, non touchée. Serveur `next dev` arrêté après
vérification.

## Phase E — Bon de caisse (terminée)

Ajoute un DEUXIÈME document PDF, distinct du reçu complet (Ticket 9),
spécifique aux règlements en mode CAISSE uniquement (cahier des charges
section 12.1).

### Différence essentielle avec le reçu complet (Ticket 9)

Le bon de caisse est **volontairement minimaliste** : il n'indique QUE le
montant effectivement réglé lors de cette opération précise — jamais le
montant demandé, le total réglé à ce jour, ni le reste à régler (réservés
au reçu complet). Exemple du cahier des charges : montant validé
250 000 FCFA, ce règlement précis 200 000 FCFA → le bon de caisse
n'affiche que "200 000 FCFA", rien de plus sur les montants. Vérifié
explicitement (voir plus bas) que ces trois libellés sont absents du PDF
généré.

### Route `GET /api/treso/reglements/[id]/bon-de-caisse`

[src/app/api/treso/reglements/\[id\]/bon-de-caisse/route.tsx](<src/app/api/treso/reglements/[id]/bon-de-caisse/route.tsx>) —
même modèle technique et **mêmes règles d'accès EXACTEMENT** que le reçu
(Ticket 9) : 401 non authentifié, 404 règlement introuvable/non confirmé,
403 si ni Finance/DG (n'importe laquelle des 5 permissions du dashboard
Finance) ni créateur de la demande. **Nouveau : 400 si le règlement n'est
pas en mode CAISSE**, avec message explicite ("Le bon de caisse n'est
disponible que pour les règlements en Caisse.") — un règlement Banque n'a
pas de sens pour ce document.

**Bénéficiaire (Phase A)** : `beneficiaireUser.fullName` si
`beneficiaireUserId` est renseigné, sinon `beneficiaireNom` (texte libre —
fournisseur, ou "SIM ASSURANCES CI"), sinon "—". Nom de fichier :
`bon-de-caisse-{référence demande}.pdf`.

### Gabarit `BonDeCaisseDocument.tsx`

En-tête identique au reçu (bandeau bleu, wordmark texte "SIM ASSURANCES" —
pas d'image, même choix documenté au Ticket 9), puis : référence de la
demande, bénéficiaire, date du règlement, le montant réglé en évidence
(grand, centré), mention du régleur. Rien d'autre.

### Refactoring partagé PDF (motivé par ce deuxième document)

Avant cette phase, `ReceiptDocument.tsx` embarquait tout en un seul
fichier (police, couleurs, formatage). Avec un deuxième document,
factorisé en modules partagés — `src/lib/pdf/` :

- `registerFonts.ts` — effet de bord `Font.register` (Montserrat), exécuté
  une seule fois grâce au cache de modules Node ; les deux documents font
  `import "./registerFonts"`. Renommé (pas `fonts.ts`) pour éviter toute
  ambiguïté de résolution avec le dossier `src/lib/pdf/fonts/` existant
  (fichiers `.ttf`).
- `colors.ts` — `COLORS`, mêmes valeurs hexadécimales que `globals.css`.
- `format.ts` — `formatMontant`/`formatDate`, voir le bug corrigé
  ci-dessous.

### Bug latent corrigé (préexistant depuis le Ticket 9, découvert ici)

`montant.toLocaleString("fr-FR")` utilise par défaut une **espace fine
insécable** (U+202F) comme séparateur de milliers. Constaté en
vérification manuelle (extraction du texte du bon de caisse via
`pdftotext`) : ce caractère précis est **absent des glyphes de la police
Montserrat embarquée** dans les PDF — le rendu affichait "2000/ 00 FCFA"
au lieu de "200 000 FCFA", le glyphe manquant perturbant le calcul des
positions par le moteur de `@react-pdf/renderer`. **Ce bug existait déjà
dans le reçu complet du Ticket 9** (même fonction `formatMontant`, jamais
remarqué car l'audit de conformité de l'époque n'avait apparemment pas
généré de montant produisant ce glyphe de façon visible, ou l'artefact
était passé inaperçu à la relecture) — reproduit et confirmé directement
sur le reçu existant en le régénérant après coup (200 000/400 000/300 000/
100 000 FCFA, tous auparavant à risque). Corrigé à la source, dans
`format.ts`, pour les DEUX documents : `formatMontant` construit le
séparateur de milliers manuellement avec une espace ordinaire (U+0020),
garantie présente dans la police. Vérifié explicitement que le reçu
existant (Ticket 9) affiche désormais correctement tous ses montants
après ce correctif.

### Tâche 2 — Bouton de téléchargement

Ajouté à côté de "Télécharger le reçu", **uniquement si
`mode === "CAISSE"` et le règlement est confirmé et non annulé** : sur
`ReglementRow.tsx` (Finance, Ticket 4) et `ReglementsRecusSection.tsx`
(Collaborateur, Ticket 9). Masqué pour les règlements Banque — la route le
refuserait de toute façon (400), mais autant ne pas proposer une action
vouée à échouer (même principe que les autres boutons conditionnels du
projet).

### Vérifié explicitement (Phase E) — vrai parcours navigateur + inspection PDF réelle

Chromium headless (Playwright) pour tout le parcours UI (création
demande, validation totale, règlement Caisse 200 000 + règlement Banque
100 000, tous deux confirmés), puis téléchargement des PDF via
`context.request` (mêmes cookies de session que le navigateur — vraie
authentification, pas de contournement) et inspection du contenu réel via
`pdftotext` (poppler, déjà présent sur la machine) :

- Bon de caisse du règlement Caisse (200 000 FCFA) : contient "BON DE
  CAISSE", le bénéficiaire ("Collaborateur Test", créateur par défaut —
  Phase A), "200 000 FCFA", le régleur ("Finance Test") ; **ne contient
  PAS** "400 000" (montant demandé), ni les libellés "Montant demandé",
  "Total réglé", "Reste à régler".
- Bon de caisse du règlement Banque : refusé, statut **400**, message
  explicite.
- Règles d'accès : compte RH (aucune permission Finance, non créateur)
  refusé en **403** ; le collaborateur créateur autorisé en **200** ;
  requête non authentifiée refusée en **401**.

`npx tsc --noEmit` et `npx eslint .` passent sans erreur. Données de test
nettoyées après coup ; la base ne contient plus que la même demande
préexistante sans rapport, non touchée. Serveur `next dev` arrêté après
vérification.

## Phase F — Saisie directe d'une dépense (terminée)

Ajoute le dernier flux de création manquant (cahier des charges section
11) : certaines dépenses sont saisies directement par Finance, sans
intervention du bénéficiaire (prime de stage, dotation carburant, dépense
pour l'entreprise, dépense collective/administrative). Le champ
bénéficiaire (Phase A) existait déjà en base mais n'avait encore jamais
été exercé par une vraie interface — toutes les demandes de test avaient
jusqu'ici bénéficiaire = créateur par défaut.

**Règle centrale, respectée à la lettre** : une fois créée, une dépense
directe suit EXACTEMENT le même circuit qu'une demande standard
(validation, règlement, fonds remis, clôture) — rien de spécifique
construit sur ces étapes, seule la Server Action de création diffère.
Vérifié explicitement de bout en bout (voir plus bas).

### Nouvelle permission et nouveaux champs

- `treso.saisir_depense_directe` — attribuée au rôle **Finance uniquement**
  dans le seed. **Choix documenté : pas au DG.** Comme
  `categoriser_demande`/`effectuer_reglement`/`cloturer_demande`, la
  saisie directe est une action opérationnelle ; le DG garde son rôle de
  validation/consultation (`valider_demande`, `voir_dashboard_finance`,
  `voir_reporting`), cohérent avec le reste du seed. Pas au Collaborateur
  non plus (le principe même de cette phase est qu'il n'intervient pas).
- `Demande.typeDemande` (enum `TypeDemande` : `STANDARD` / `DEPENSE_DIRECTE`,
  défaut `STANDARD`) et `Demande.natureDepenseDirecte` (enum
  `NatureDepenseDirecte` : `PRIME_STAGE`/`DOTATION_CARBURANT`/
  `DEPENSE_ENTREPRISE`/`DEPENSE_COLLECTIVE`/`AUTRE`, nullable, renseigné
  uniquement si `typeDemande = DEPENSE_DIRECTE`). Migration
  `phase_f_depense_directe`.

### Écran de saisie (`treso/finance/depenses-directes/nouvelle/`)

Réservé à `treso.saisir_depense_directe`, gardé à la page ET revérifié
dans `creerDepenseDirecteAction` (jamais uniquement la garde partagée de
`finance/layout.tsx`, désormais élargie à cette permission en plus des
cinq précédentes).

**Le bénéficiaire s'adapte au type choisi** (`beneficiaireType`, suivi en
état local pour le rendu conditionnel côté client, `defaultValue`/
`onChange` — jamais `value`, même piège Select déjà documenté au Ticket 2) :

- `COLLABORATEUR` — a toujours un compte : sélecteur d'utilisateur
  uniquement (obligatoire).
- `STAGIAIRE` — peut avoir un compte ou non : **les deux champs sont
  proposés** (sélecteur ET nom libre), l'utilisateur remplit celui qui
  s'applique ; la cohérence (au moins l'un des deux) est revérifiée côté
  serveur.
- `FOURNISSEUR` — jamais de compte : nom libre uniquement (obligatoire).
- `ENTREPRISE` — nom libre, pré-rempli "SIM ASSURANCES CI" (éditable).

**Liste des utilisateurs proposée au sélecteur** : tous les utilisateurs
actifs, quel que soit leur rôle applicatif — il n'existe pas de rôle
"Stagiaire" dédié dans le Socle (un stagiaire avec compte reçoit
simplement un compte de rôle Collaborateur), donc aucune distinction de
rôle ne permettrait de restreindre cette liste plus finement en V1.

Pièce jointe : champ visuellement présent mais désactivé, comme partout
ailleurs dans le projet (pas de solution de stockage — voir Ticket 1).

### Server Action `creerDepenseDirecteAction`

`createurId` = utilisateur Finance connecté, `typeDemande =
DEPENSE_DIRECTE`, `natureDepenseDirecte` renseignée, **statut initial
`EN_ATTENTE_VALIDATION`** (jamais pré-validée automatiquement — le circuit
de validation normal s'applique intégralement, y compris la possibilité
d'un rejet). Référence générée comme d'habitude
(`generateDemandeReference`, même retry sur conflit que la création
standard). `HistoriqueEntry` (`action: "creation"`) précise qu'il s'agit
d'une dépense saisie directement, avec la nature et le bénéficiaire.

### Affichage du bénéficiaire (Tâche 4)

Factorisé dans `src/components/tresorerie/beneficiaire.ts`
(`BENEFICIAIRE_TYPE_LABEL`, `getBeneficiaireNom` — réutilisée aussi par la
route du bon de caisse, Phase E, qui dupliquait cette même logique) et
`depenseDirecte.ts` (`NATURE_DEPENSE_DIRECTE_LABEL`,
`DepenseDirecteBadge.tsx` pour le badge "Dépense directe — {nature}").
Affiché sur : le détail Finance, le détail Collaborateur, la liste "Mes
demandes" et la liste "Demandes à traiter (Finance)" (nouvelle colonne
"Bénéficiaire", distincte de "Créateur" — essentiel pour ne jamais
confondre les deux sur une dépense directe).

**Cohérence de `/treso/demandes/[id]` documentée (Tâche 4)** : pour une
`DEPENSE_DIRECTE`, le créateur est Finance, jamais le bénéficiaire réel.
Conséquence : cet écran reste mécaniquement accessible et fonctionnel
(Finance EST le créateur, la garde `createurId === session.user.id`
passe), mais **le bénéficiaire, même s'il a un compte Collaborateur, ne
voit jamais "sa" dépense directe dans son propre "Mes demandes"** (filtré
par `createurId`, jamais par bénéficiaire). Aucun onglet "Dépenses dont je
suis bénéficiaire" n'existe à ce stade — volontairement hors périmètre de
cette phase, à évaluer avec le maître de stage si le besoin se confirme.

**Bug préexistant corrigé au passage** : `RetoursCaisseSection` sur cet
écran affichait le bouton "Déclarer un retour de caisse"
(`peutDeclarer={demande.statut !== "CLOTUREE"}`) sans jamais vérifier
`treso.declarer_retour` — sans conséquence tant que le créateur était
toujours un Collaborateur (qui l'a systématiquement dans le seed), mais
une dépense directe créée par Finance (qui ne l'a pas) aurait affiché un
bouton voué à échouer côté serveur. Corrigé :
`peutDeclarerRetour = statut !== "CLOTUREE" && hasPermission(session,
"treso.declarer_retour")` — même principe que `canEffectuerReglement`
ailleurs dans le projet.

### Navigation (Tâche 5)

"Nouvelle dépense directe" (icône `plus-circle`, nouvelle entrée dans
`src/components/icons.tsx`) ajouté dans la branche "Demande d'Achat",
visible avec le nouveau booléen `canSaisirDepenseDirecte` (`NavFlags`),
propagé comme les précédents via `(dashboard)/layout.tsx` → `AppShell` →
`Sidebar`.

### Filtre reporting par type de demande (Tâche 6)

`ReportingFilters.typeDemande` ajouté (Ticket 10) — parsing, query string
et `buildDemandeWhere` mis à jour dans `reporting.ts`, nouveau Select
"Type de demande" dans `ReportingFiltersForm.tsx` (options dérivées de
`TYPE_DEMANDE_LABEL`, même principe que le Select "Statut"). L'export
Excel en bénéficie automatiquement (mêmes fonctions partagées).

### Vérifié explicitement (Phase F) — vrai parcours navigateur

Chromium headless (Playwright, non ajouté au projet) contre le vrai
serveur `next dev`, avec `finance@simassurances.test` et
`collaborateur@simassurances.test` :

1. `collaborateur@` tente `/treso/finance/depenses-directes/nouvelle` →
   redirigé (`/?error=acces_refuse_saisir_depense_directe`).
2. Finance crée une dépense directe (nature "Prime de stage", bénéficiaire
   Stagiaire sans compte — nom libre "Jean Kouassi", 50 000 FCFA).
3. Liste "Demandes à traiter (Finance)" : badge "Dépense directe — Prime
   de stage" visible, bénéficiaire "Jean Kouassi" affiché **distinctement**
   du créateur "Finance Test".
4. Détail : bénéficiaire "Jean Kouassi (Stagiaire)" affiché, jamais
   confondu avec Finance.
5. Circuit normal identique à une demande standard : validation totale,
   règlement Caisse de 50 000 confirmé → statut final **Réglée**.
6. Filtre reporting `typeDemande=DEPENSE_DIRECTE` vérifié par appel direct
   de `getReportingRows` (fonction sans dépendance de session, comme en
   Phase B) sur les données produites par le parcours navigateur : exactement
   1 ligne, montant demandé/validé/réglé = 50 000, reste = 0 ; filtre
   `typeDemande=STANDARD` sur les mêmes données : 0 ligne (aucune demande
   standard en base à ce moment).

`npx tsc --noEmit` et `npx eslint .` passent sans erreur (après un `rm -rf
.next` + `npm run build` pour régénérer les types Next.js auto-générés,
même piège transitoire déjà documenté en Phase A).

**⚠️ Effet de bord signalé par transparence** : l'ajout de la permission
`treso.saisir_depense_directe` a nécessité de relancer `npx prisma db
seed` pour qu'elle existe en base et soit attribuée au rôle Finance — ce
seed fait un `deleteMany` sur `Demande` (entre autres) avant de
resemer, comme documenté dans `DEPLOIEMENT.md`/CLAUDE.md ("ne jamais
lancer en routine"). Cela a supprimé la demande de test préexistante
(`DEM-2026-000001`, "Payez le carburant") qui subsistait depuis les phases
précédentes — sans lien avec le code de cette phase, mais une perte de
données réelle qu'il convient de signaler explicitement plutôt que de la
passer sous silence. La base ne contient plus aucune demande après le
nettoyage de cette phase.

## Phase G — Dashboard Finance enrichi : zone "À traiter" (terminée)

Refond le dashboard Finance (Ticket 8, 4 indicateurs) en une zone "À
traiter" à **6 indicateurs cliquables**, conformément à la section 12 du
cahier des charges. Le Solde de caisse reste affiché mais devient une
information de **contexte** distincte (bandeau dédié, pas une carte "à
traiter" — ce n'est pas une action).

### Les 6 indicateurs — définitions exactes (`src/lib/dashboardFinance.ts`)

| # | Indicateur | Définition | Cible |
|---|---|---|---|
| 1 | Demandes en attente de validation | `statut ∈ {EN_ATTENTE_VALIDATION, PARTIELLEMENT_VALIDEE}` | `/treso/finance/demandes` |
| 2 | Montants validés restant à régler | `montantValide > 0`, reste à régler > 0, **rien réglé encore** (`getTotalRegle = 0`) | `/treso/finance/a-decaisser` |
| 3 | Règlements partiels à compléter | reste à régler > 0, **déjà réglé en partie** (`getTotalRegle > 0`) | `/treso/finance/reglements-partiels` (nouveau) |
| 4 | Fonds remis à régulariser | règlements CAISSE confirmés non annulés dont `getSoldeARegulariser(reglementId) ≠ 0` | `/treso/finance/fonds-a-regulariser` (nouveau) |
| 5 | Retours de fonds en attente de réception | reprend `RETOUR_EN_ATTENTE_WHERE` (Ticket 6/8), inchangé | `/treso/finance/retours` |
| 6 | Dépenses non justifiées à suivre | `DepenseLigne` `SANS_PIECE` dont le règlement lié a un solde à régulariser ≠ 0 | `/treso/finance/depenses-non-justifiees` (nouveau) |

Les indicateurs 2 et 3 sont **mutuellement exclusifs** par construction
(`getTotalRegle = 0` vs `> 0`) : une même demande ne peut jamais apparaître
dans les deux à la fois — vérifié explicitement (voir plus bas). Les
indicateurs 4, 5 et 6 en revanche **peuvent se recouper sur un même
règlement** (ex: un règlement Caisse peut simultanément avoir un solde non
nul, un retour en attente de réception, ET une ligne non justifiée) — ce
n'est PAS une contradiction, ce sont trois angles différents d'un même
cycle de régularisation non terminé.

**Point non intuitif vérifié explicitement** : l'indicateur 4 compte TOUT
règlement Caisse confirmé dont le solde n'est pas nul — y compris un
règlement pour lequel **aucun retour n'a même encore été déclaré**. En
pratique, cela signifie qu'un règlement Caisse fraîchement confirmé
apparaît immédiatement ici (son solde vaut son montant intégral tant que
rien n'est déclaré/reçu), pas seulement les règlements où un retour est
resté bloqué. C'est la définition littérale donnée pour cette phase, pas
un raffinement de ma part — confirmé par le jeu de test (un règlement de
80 000 sans aucun retour déclaré comptait bien dans cet indicateur, aux
côtés d'un autre à 50 000 avec un retour en attente).

### Ancien indicateur "Décaissements à régulariser" (Ticket 8) : conservé, mais plus dans les 6

`getDecaissementsARegulariser()` (demandes entièrement réglées, candidates
à la clôture Ticket 7) n'est pas mentionné par la section 12 du nouveau
cahier des charges — il ne fait donc plus partie des 6 cartes "À traiter".
**Choix délibéré : ni retiré ni relégué dans un coin invisible.** La
clôture (Ticket 7) doit rester praticable, donc `/treso/finance/a-regulariser`
reste pleinement fonctionnelle et accessible via un **lien secondaire
discret** en bas de la page du dashboard (texte simple, pas une carte) —
évite de rendre cette liste orpheline tout en respectant la hiérarchie
visuelle demandée (6 cartes au premier plan, ce lien nettement en retrait).

### Écart corrigé sur les listes existantes (Tâche 3)

- `/treso/finance/a-decaisser` — s'appelait "Demandes à décaisser" et
  incluait AUSSI les règlements partiels avant cette phase ; filtre
  resserré à `totalRegle === 0` et retitré "Montants validés restant à
  régler" pour correspondre exactement à l'indicateur 2.
- `/treso/finance/demandes` — s'appelait "Demandes à catégoriser" et ne
  listait que `EN_ATTENTE_VALIDATION` ; élargi à `EN_ATTENTE_VALIDATION`
  **et** `PARTIELLEMENT_VALIDEE` pour correspondre exactement à
  l'indicateur 1, retitré "Demandes en attente de validation". Le bouton
  d'action de sa table (`DemandesACategoriserTable`) est renommé
  "Catégoriser" → "Traiter" (une demande partiellement validée n'a plus
  rien à "catégoriser" au sens propre, elle attend une validation
  complémentaire).
- `/treso/finance/retours` — inchangée, déjà exactement l'indicateur 5.

### Nouvelles listes (Tâche 3)

`reglements-partiels/`, `fonds-a-regulariser/` et `depenses-non-justifiees/`
— même pattern que toutes les listes Finance existantes (wrapper Client
autour de `DataTable`, garde `treso.voir_dashboard_finance`, tri par
ancienneté). `fonds-a-regulariser` et `depenses-non-justifiees` renvoient
vers le détail de la demande ("Voir la demande") plutôt qu'un écran dédié
par règlement, qui n'existe pas dans le portail — la demande reste le
point d'entrée naturel pour agir (réceptionner un retour se fait depuis
`/treso/finance/retours`, indicateur #5 distinct).

### Fonction batch partagée (`getSoldesARegulariserParReglements`)

`getSoldeARegulariser(reglementId)` (Phase D) est devenue un simple appel à
`getSoldesARegulariserParReglements([reglementId])` (`src/lib/tresorerie.ts`) :
une seule requête `DepenseLigne`/`RetourCaisse` pour plusieurs règlements à
la fois (réduite en mémoire), réutilisée par les indicateurs 4 et 6 pour
éviter une requête par règlement — jamais deux implémentations de la même
formule.

### Tâche 4 — Navigation : choix d'ergonomie documenté

**Les 3 nouvelles listes ne sont PAS ajoutées à la sidebar**, uniquement
accessibles via les cartes du dashboard — même principe déjà en place pour
`a-decaisser`/`a-regulariser`/`retours` avant cette phase (jamais dans
`nav.ts`, seulement des cibles de clic). Ajouter 3 entrées de plus
surchargerait la branche "Demande d'Achat" (déjà 5 entrées conditionnelles)
sans bénéfice réel : le dashboard est l'écran d'atterrissage naturel de
Finance/DG (déjà dans la sidebar, "Tableau de bord Finance"), donc ces
listes restent à un clic de distance en toute circonstance.

### Choix design (rendu professionnel demandé explicitement)

Skill `ui-ux-pro-max` consultée avant codage (style "Data-Dense Dashboard"
— grille dense, KPI cards, feedback hover/focus, stagger d'entrée standard
300-450 ms) : guidance structurelle retenue, palette/typographie NON
reprises (la charte SIM Assurances — Montserrat, tokens `sim-*` — reste la
seule source de vérité chromatique du portail).

- **`StatCard`** (`src/components/ui/StatCard.tsx`) gagne un prop `href`
  optionnel : rendue comme `next/link` avec micro-interactions (léger
  soulèvement `-translate-y-0.5`, icône `scale-110`, halo de focus/hover
  teinté selon `tone`, invite "Voir le détail" avec flèche animée) —
  gardée rétro-compatible (sans `href`, comportement statique inchangé,
  toujours utilisée telle quelle par le dashboard général
  `(dashboard)/page.tsx`). Toutes les transforms (translate/scale) sont
  gardées par `motion-safe:` — inertes sous `prefers-reduced-motion`, sans
  JavaScript. Au passage, corrigé un oubli préexistant : `StatCard`
  codait ses couleurs en dur (`slate-*`, `bg-white`) au lieu des tokens
  sémantiques du projet (`border-border`, `bg-surface`,
  `text-muted-foreground`, `text-foreground`) — même rendu visuel, mais
  conforme à la règle du projet ("ne jamais coder une couleur en dur").
  Nouveau tone `"danger"` ajouté à `StatTone` (`bg-danger-bg`/`text-danger`),
  jusqu'ici absent — nécessaire pour l'indicateur 6.
- **Teinte adaptative selon l'urgence réelle** (auto-critique appliquée
  après une première passe) : une carte ne s'allume dans sa teinte
  d'urgence (warning/info/danger) que si son nombre est `> 0` — à 0, elle
  repasse en `neutral`. Sans ce garde-fou, "Dépenses non justifiées à
  suivre" se serait affichée en rouge alarmant même à zéro dépense non
  justifiée : la hiérarchie visuelle ne doit signaler que ce qui est
  réellement actionnable (`toneSiActif()`, `treso/finance/page.tsx`).
- **Entrée en fondu/décalage** des 6 cartes (`.stat-card-enter` /
  `@keyframes stat-card-in`, `globals.css`) : un seul keyframe CSS partagé,
  décalé par carte via `:nth-child` (40 ms de pas, ~200 ms max) — pas de
  librairie d'animation (GSAP serait disproportionné pour 6 cartes
  statiques). Entièrement neutralisée sous `prefers-reduced-motion:
  reduce` (media query dédiée) : rendu direct dans l'état final.
- **Bandeau Solde de caisse** délibérément distinct des 6 cartes : pas de
  bordure `border-border` neutre ni de lien cliquable, teinte primaire
  (identité SIM Assurances) avec icône dans un cercle plein plutôt que la
  pastille arrondie des `StatCard` — signale visuellement "ceci est un
  chiffre de référence, pas une action" avant même de lire le texte.
- Badge de synthèse "X points au total" (ou "Tout est à jour" en vert si
  0) en tête de la zone "À traiter" — vue d'ensemble immédiate sans
  addition mentale.

### Vérifié explicitement (Phase G) — vrai parcours navigateur

Chromium headless (Playwright) contre le vrai serveur `next dev`. Jeu de
données couvrant les 6 cas simultanément (4 demandes) :

- Demande A (100 000) laissée `EN_ATTENTE_VALIDATION` → indicateur 1.
- Demande B (100 000) validée totalement, aucun règlement → indicateur 2
  (100 000 FCFA).
- Demande C (200 000) validée totalement + règlement Caisse de 80 000
  confirmé → indicateur 3 (reste 120 000 FCFA) — règlement également
  compté dans l'indicateur 4 (aucun retour déclaré, solde = 80 000).
- Demande D (150 000) validée totalement + réglée intégralement (Caisse) +
  retour déclaré (2 lignes : 70 000 avec facture, 30 000 sans pièce) mais
  **non réceptionné** → indicateurs 4 (solde 50 000), 5 (retour en
  attente), et 6 (30 000 FCFA non justifiés).

Dashboard vérifié : 7 points au total, chaque carte affiche le bon
nombre/montant (indicateur 4 = 2 règlements/130 000 FCFA, voir
l'explication ci-dessus), solde de caisse = −230 000 FCFA
(−80 000 − 150 000), lien secondaire "Décaissements... en attente de
clôture" = 1 (D). Chaque carte cliquée mène à la bonne liste avec les
bonnes données. **Non-contradiction vérifiée explicitement** : B absente
de "Règlements partiels à compléter", C et D absentes de "Montants validés
restant à régler" — les indicateurs 2/3 restent mutuellement exclusifs en
pratique, pas seulement en théorie.

`npx tsc --noEmit` et `npx eslint .` passent sans erreur. Données de test
nettoyées après coup (0 demande restante). Serveur `next dev` arrêté après
vérification.

## Phase H — Reporting et Export adaptés au nouveau modèle (terminée)

Dernière phase de la refonte V1 : adapte le Reporting/Export (Ticket 10)
au nouveau modèle (validation partielle, bénéficiaire, dépenses détaillées).

### Nouvelles colonnes du tableau agrégé (`ReportingRow`, `src/lib/reporting.ts`)

**Changement de fond sur "Validé"** : devient la somme du champ
`Demande.montantValide` lui-même, plus une somme conditionnée par le
statut (l'ancien calcul, hérité d'avant la Phase B, ignorait les
validations partielles — une demande `PARTIELLEMENT_VALIDEE` contribuait
0 à "Validé" au lieu de son montant réellement validé). `STATUTS_VALIDES`
(devenu inutile avec ce changement) supprimé.

Deux notions à ne jamais confondre, l'une sur la VALIDATION, l'autre sur
le RÈGLEMENT :

| Colonne | Formule | Porte sur |
|---|---|---|
| Restant à valider (nouvelle) | `max(0, Demandé − Validé)` | validation |
| Validé restant à régler (renommée depuis "Reste à régler") | `max(0, Validé − Réglé)` | règlement |

"Réglé" reste basé sur `getTotalRegle` (via le `groupBy` déjà existant),
inchangé.

### Nouveaux filtres

- **Bénéficiaire** (Tâche 2) — DISTINCT du filtre "Demandeur" (toujours le
  créateur). Un seul paramètre `beneficiaire` encodé (`u:<userId>` /
  `n:<nom>`, voir `parseReportingFilters`/`getBeneficiairesConnus`) pour
  couvrir les deux cas (bénéficiaire avec ou sans compte, Phase A).
- **Type de demande** (Standard / Dépense directe, Phase F) — déjà
  fonctionnel, vérifié à nouveau ici (aucun changement nécessaire).

### Nouvelle feuille d'export "Dépenses déclarées" (`getReportingDepensesDetail`)

Une ligne par `DepenseLigne` (Phase D) des demandes filtrées — référence,
bénéficiaire, montant, objet, date, nature, justification, colonne
"Non justifiée" (Oui/Non). Les lignes `SANS_PIECE` sont surlignées (fond
`#FEF3ED`, police orange) dans le classeur Excel pour un repérage visuel
immédiat, en plus de la colonne dédiée.

### Feuille "Suivi budgétaire" : note ajoutée, pas supprimée (Tâche 4)

Vérifié explicitement : une demande créée depuis la refonte V1 n'a plus de
`budgetDisponible` renseigné (Catégorie/Objet/Budget écartés depuis la
Phase A), donc cette feuille — et la section correspondante de l'écran —
restent vides pour toute donnée récente. Une note explicite est insérée
dans la feuille elle-même quand c'est le cas ("Fonctionnalité liée à
Catégorie/Objet/Budget, statut à confirmer avec le maître de stage — voir
CLAUDE.md"), la feuille et son code restant intacts pour d'éventuelles
données antérieures à la refonte.

### Vérifié explicitement (Phase H) — vrai parcours navigateur + export réel

Chromium headless (Playwright) + lecture programmatique du classeur
téléchargé via `exceljs` (déjà une dépendance du projet — pas d'outil
supplémentaire nécessaire). Jeu de données : une demande standard de
400 000 validée partiellement à 250 000, réglée à 200 000 (Caisse), avec
un retour déclaré (120 000 FCFA avec facture + 30 000 FCFA sans pièce) ;
une dépense directe de 60 000 pour un bénéficiaire externe ("Fournisseur
ABC"), validée et réglée intégralement (Banque).

- Tableau agrégé (sans filtre) : Demandé 460 000, Validé 310 000, Restant
  à valider 150 000, Réglé 260 000, Validé restant à régler 50 000, Réglé
  Caisse 200 000, Réglé Banque 60 000 — **Demandé = Validé + Restant à
  valider** vérifié (460 000 = 310 000 + 150 000).
- Filtre Type de demande = Dépense directe : isole exactement la demande à
  60 000 (Restant à valider = 0, entièrement réglée).
- Filtre Bénéficiaire = "Fournisseur ABC" : isole la même demande, DISTINCT
  du filtre Demandeur (qui aurait renvoyé "Finance Test", le créateur).
- Export Excel : feuille "Reporting" relue programmatiquement, chiffres du
  Total général strictement identiques à l'écran pour les mêmes filtres
  (cohérence Tâche 5). Feuille "Dépenses déclarées" : 2 lignes, la ligne
  30 000 marquée "Oui"/surlignée, la ligne 120 000 marquée "Non"/non
  surlignée. Feuille "Suivi budgétaire" : note explicite présente.

`npx tsc --noEmit` et `npx eslint .` passent sans erreur. Données de test
nettoyées après coup (0 demande restante). Serveur `next dev` arrêté après
vérification.

---

# Refonte V1 — TERMINÉE

Les 8 phases (A à H) de la réécriture du Module Trésorerie selon le
nouveau cahier des charges sont maintenant complètes et vérifiées par de
vrais parcours navigateur. Récapitulatif, une ligne par phase :

- **Phase A** — Fondations de données : nouveau `StatutDemande` (11
  valeurs), bénéficiaire (`BeneficiaireType`/`beneficiaireUserId`/
  `beneficiaireNom`), `montantValide`, Catégorie/Objet/Budget retirés du
  flux principal (conservés en base).
- **Phase B** — Validation partielle et complémentaire : fonction centrale
  `calculerStatutDemande`, `validerTotalementAction`/
  `validerPartiellementAction`/`validerComplementaireAction`.
- **Phase C** — Règlement adapté à la validation partielle : correction
  du périmètre de la Phase B (`getResteARegler` basé sur `montantValide`,
  pas le montant demandé), un règlement est possible dès qu'un montant est
  validé, même partiellement.
- **Phase D** — Fonds remis (lignes de dépenses détaillées) : modèle
  `DepenseLigne` remplace le montant dépensé agrégé unique ; montant à
  retourner calculé automatiquement, jamais saisi.
- **Phase E** — Bon de caisse : second document PDF minimaliste pour les
  règlements Caisse, distinct du reçu complet ; bug latent de formatage
  des montants dans les PDF corrigé au passage (affectait aussi le reçu
  du Ticket 9 depuis l'origine).
- **Phase F** — Saisie directe d'une dépense : Finance peut créer une
  demande pour un bénéficiaire qui n'intervient pas lui-même (prime de
  stage, dotation carburant, dépense entreprise...), circuit ensuite
  identique à une demande standard.
- **Phase G** — Dashboard Finance enrichi : zone "À traiter" à 6
  indicateurs cliquables (validation, règlement non commencé/partiel,
  fonds à régulariser, retours en attente, dépenses non justifiées), solde
  de caisse gardé comme contexte distinct.
- **Phase H** — Reporting et Export adaptés : colonnes Validé/Restant à
  valider/Validé restant à régler clarifiées, filtres Bénéficiaire et Type
  de demande, feuille d'export "Dépenses déclarées".

## Points d'interprétation en attente — synthèse pour le maître de stage

Accumulés au fil des 8 phases, tous déjà documentés à l'endroit où ils ont
été rencontrés (voir les sections de phase correspondantes) — regroupés
ici pour n'avoir qu'un seul point de synthèse à soumettre :

1. **Sort de Catégorie/Objet/Budget** (Phase A) — retirés du cahier des
   charges et du flux principal (formulaires, règlement, dashboard,
   filtres), mais les modèles, le CRUD admin (`/admin/categories`), et la
   feuille "Suivi budgétaire" du reporting restent en place par
   précaution. Décision à prendre : supprimer définitivement, ou garder
   en dormance pour un usage futur ?
2. **Statut `VALIDEE` devenu invisible en pratique** (Phase B) — n'est
   plus jamais produit par `calculerStatutDemande` : une validation totale
   transite directement vers `VALIDEE_NON_REGLEE` (puis
   `PARTIELLEMENT_REGLEE`/`REGLEE`). `VALIDEE` reste dans l'enum
   uniquement pour compatibilité (`STATUTS_VALIDATION_COMPLETE`). Est-ce
   le comportement voulu, ou `VALIDEE` devrait-il réapparaître comme statut
   affiché explicitement à un moment du circuit ?
3. **Rejet impossible après une validation partielle** (Phase B) — une
   demande déjà `PARTIELLEMENT_VALIDEE` ne peut plus être "rejetée" au
   sens strict (seul le reliquat peut encore recevoir une validation
   complémentaire). Aucune action de "rejet du reliquat" n'existe : si un
   validateur veut abandonner la partie non encore validée d'une demande,
   ce cas reste sans réponse applicative à ce stade.
4. **Bénéficiaire d'une dépense directe invisible dans son propre espace**
   (Phase F) — un bénéficiaire ayant un compte Collaborateur ne voit
   jamais "sa" dépense directe dans "Mes demandes" (filtré par créateur,
   jamais par bénéficiaire). Aucun onglet "Dépenses dont je suis
   bénéficiaire" n'existe.
5. **Ancien indicateur "Décaissements à régulariser" hors des 6 nouveaux**
   (Phase G) — les demandes entièrement réglées candidates à la clôture
   (Ticket 7) ne font plus partie de la zone "À traiter" (absentes de la
   section 12 du nouveau cahier des charges), mais restent accessibles via
   un lien secondaire discret en bas du dashboard. À confirmer que cet
   emplacement convient, ou si un traitement différent est attendu.
6. **Indicateur "Fonds remis à régulariser" potentiellement très large**
   (Phase G) — compte TOUT règlement Caisse dont le solde n'est pas nul,
   y compris ceux pour lesquels aucun retour n'a même encore été déclaré.
   En pratique, la quasi-totalité des règlements Caisse récents y
   apparaîtront tant que leur cycle de fonds remis n'est pas bouclé. C'est
   la définition littérale donnée pour cette phase — à valider que ce
   comportement correspond bien à l'intention du cahier des charges, ou si
   un délai de grâce (ex: N jours après confirmation) devrait s'appliquer
   avant qu'un règlement n'y apparaisse.
7. **Feuille "Suivi budgétaire" vide pour toute donnée récente** (Phase H,
   conséquence directe du point 1) — une note explicite y a été ajoutée,
   mais son sort final (conserver, retirer, ou remplacer par autre chose)
   dépend entièrement de la décision sur Catégorie/Objet/Budget.
8. **Pièce jointe toujours non implémentée** (Ticket 1, antérieur à la
   refonte V1 mais toujours vrai) — champ visuellement présent mais
   désactivé partout où il apparaît (demande standard, dépense directe) :
   aucune solution de stockage de fichiers choisie à ce jour.

## Module Trésorerie : Ticket 1 — Création de demande (Collaborateur)

**Statut : terminé.** Routes sous
[src/app/(dashboard)/treso/demandes/](<src/app/(dashboard)/treso/demandes>)
(voir [Structure des dossiers](#structure-des-dossiers)) :

- `treso/demandes` — "Mes demandes", filtrée sur `createurId = session.user.id`
  (chaque utilisateur ne voit que ses propres demandes), tri décroissant sur
  `createdAt`. Le bouton "Nouvelle demande" n'apparaît que si
  `hasPermission(session, "treso.creer_demande")`.
- `treso/demandes/nouvelle` — formulaire de création, gardé côté page
  (`redirect("/?error=acces_refuse_creer_demande")` si la permission
  manque) et revérifié dans la Server Action (jamais uniquement le layout).

**Génération de référence** — `generateDemandeReference()` dans
[src/lib/reference.ts](src/lib/reference.ts) : format `DEM-2026-000123`
(préfixe + année + compteur sur 6 chiffres, remis à zéro chaque année).
V1 volontairement simple : compte les demandes de l'année en cours et
incrémente. Gestion de la concurrence sans sur-ingénierie : la contrainte
`@unique` sur `Demande.reference` protège la base, et
`treso/demandes/nouvelle/actions.ts` retente (jusqu'à 5 fois) avec une
référence fraîchement recalculée si la création échoue sur un conflit
(`Prisma.PrismaClientKnownRequestError`, code `P2002`, cible `reference`) —
pas de verrou ni de table de séquence dédiée.

**Pièce jointe non implémentée en V1** — aucune solution de stockage de
fichiers n'existe encore dans le projet. Le champ est visuellement présent
dans le formulaire mais désactivé (`disabled`), avec une note "à venir".
À câbler quand une solution de stockage (S3, disque, etc.) sera choisie —
le modèle `PieceJointe` existe déjà côté schéma, prêt à recevoir des URLs.

**Coquille applicative rendue responsive** — en construisant ce formulaire,
la sidebar (`src/components/layout/`) s'est révélée non utilisable sur
mobile (toujours en flux normal, largeur fixe, laissant une colonne de
contenu de quelques dizaines de pixels sur un écran de téléphone), alors
que le cahier des charges insiste sur l'usage mobile pour les collaborateurs
sans ordinateur. Corrigé à la source plutôt que contourné : `Sidebar`
devient un tiroir hors-écran en dessous de `lg` (position fixe, glissé
depuis la gauche, fond d'estompage cliquable, refermeture automatique au
clic sur un lien), ouvert via un bouton menu ajouté dans `Topbar`. Comportement
desktop (`lg:` et plus) inchangé. Ce correctif bénéficie à tout le portail,
pas seulement à cet écran — voir `AppShell.tsx`/`Sidebar.tsx`/`Topbar.tsx`.

## Module Trésorerie : Ticket 2 — Catégorisation par Finance

**Statut : terminé.** Routes sous
[src/app/(dashboard)/treso/finance/](<src/app/(dashboard)/treso/finance>) :

- `treso/finance/layout.tsx` — garde l'ensemble de l'espace Finance
  (`treso.categoriser_demande`), même pattern que `admin/layout.tsx` :
  `redirect("/?error=acces_refuse_categoriser")` si la permission manque.
  Couvre `finance/demandes` et `finance/demandes/[id]` sans dupliquer la
  garde sur chaque page — et couvrira automatiquement tout futur écran
  Finance placé sous ce dossier (règlements, reporting...).
- `treso/finance/demandes` — "Demandes à catégoriser" : **toutes** les
  demandes `EN_ATTENTE` du système (pas seulement celles de l'utilisateur
  connecté, contrairement à `treso/demandes` du Ticket 1), triées par
  ancienneté croissante (`orderBy: { createdAt: "asc" }`) — les plus
  anciennes remontent en premier, plus utile pour Finance qu'un tri
  anti-chronologique.
- `treso/finance/demandes/[id]` — détail + catégorisation. Rendu
  conditionnel selon `demande.statut` :
  - `EN_ATTENTE` → formulaire (`CategorisationForm`, Client Component).
    Pré-rempli avec les valeurs déjà enregistrées si la demande a déjà été
    catégorisée mais reste en attente (Finance peut corriger tant qu'elle
    n'est pas validée) ; redirige vers la liste après succès plutôt que de
    rester sur un formulaire visuellement réinitialisé.
  - `VALIDEE` → catégorie/objet/budget affichés en lecture seule avec un
    message explicite de verrouillage. Aucun formulaire.
  - Tout autre statut (`REJETEE`, `CLOTUREE_*`) → détail en lecture seule,
    pas de catégorisation (n'a pas de sens à ce stade).

**Filtrage Catégorie → Objet** — entièrement côté client, sans requête
réseau supplémentaire : la page serveur charge une fois toutes les
`Categorie` et tous les `Objet` (faible volume : 9 catégories, quelques
objets), `CategorisationForm` les filtre en mémoire au changement de
catégorie (`useMemo` sur `objets.filter(o => o.categorieId === categorieId)`).
Le `<Select>` Objet est remonté (`key={categorieId}`) à chaque changement de
catégorie pour repartir d'une sélection propre. Approche volontairement
simple, à revoir avec un vrai fetch si le nombre d'objets grossit beaucoup.

**Défense en profondeur sur le verrouillage** (règle impérative du cahier
des charges) — `treso/finance/demandes/[id]/actions.ts` ne fait jamais
confiance à l'UI seule : `categoriserDemandeAction` recharge la demande
et **revérifie `statut === "EN_ATTENTE"` juste avant l'écriture**, même si
l'interface ne devrait normalement présenter le formulaire que dans ce cas
(le statut a pu changer entre l'affichage de la page et la soumission —
ex: validée entre-temps par un autre utilisateur Finance). Vérifié
manuellement en forçant une demande à `VALIDEE` en base puis en
contournant volontairement la garde d'UI : la Server Action a bien refusé
l'écriture (toast d'erreur, aucune modification en base). Même principe
que la vérification `isAdmin(session)` dans chaque Server Action de
`/admin` — jamais uniquement le layout ou le masquage de l'UI.

**Statut métier factorisé** —
[src/components/tresorerie/demandeStatut.ts](src/components/tresorerie/demandeStatut.ts)
exporte `STATUT_DEMANDE_BADGE_VARIANT` et `STATUT_DEMANDE_LABEL`, utilisés
par `MesDemandesTable` (Ticket 1), `DemandesACategoriserTable` et le détail
Finance — évite de dupliquer le mapping `StatutDemande -> Badge` à chaque
nouvel écran qui affiche un statut.

**Gestion CRUD Catégorie/Objet** — vérifiée avant ce ticket : n'existe nulle
part encore dans le projet (seulement les 9 catégories/3 objets du seed).
Hors périmètre des tâches de ce ticket. **Résolu au Ticket A.1** (console
admin `/admin/categories`, voir [Administration](#administration-console-admin)) —
cette note reste ici pour l'historique de la dette identifiée à ce moment.

**Navigation conditionnelle par permission** — `nav.ts` expose désormais
`getNavBranches({ canAccesFinanceDemandes })` (fonction, plus une constante
statique) pour insérer conditionnellement l'entrée "Demandes à traiter
(Finance)" dans la branche "Demande d'Achat". Le booléen est calculé une
fois dans `(dashboard)/layout.tsx` et descend via `AppShell` → `Sidebar`,
exactement comme `canAdmin`/`isAdmin()` pour la section "Administration" —
même pattern à suivre pour toute future entrée de nav conditionnée par une
permission. **Mis à jour au Ticket 3** : ce booléen vaut
`categoriser_demande OU valider_demande` (pas juste `categoriser_demande`)
puisque le DG accède au même espace pour valider/rejeter — voir Ticket 3
ci-dessous pour le détail.

## Module Trésorerie : Ticket 3 — Validation / Rejet d'une demande

**Statut : terminé.**

**Garde élargie** — `treso/finance/layout.tsx` accepte désormais
`treso.categoriser_demande` **OU** `treso.valider_demande` (avant : seulement
la première). Le DG (`treso.valider_demande`, pas `treso.categoriser_demande`
dans le seed) partage donc le même espace `/treso/finance/*` que Finance,
mais **la page de détail affiche des actions différentes selon la
permission précise** — ne jamais supposer qu'un utilisateur qui a passé la
garde du layout a les deux permissions :

- A `treso.categoriser_demande` → voit le formulaire de catégorisation
  (`CategorisationForm`) si `EN_ATTENTE`.
- N'a pas `treso.categoriser_demande` → voit un résumé en lecture seule
  (catégorie/objet/budget, ou "Non catégorisée") à la place du formulaire,
  quel que soit son autre statut de permission — c'est le cas du DG, qui a
  besoin de voir la catégorisation pour décider, sans pouvoir la modifier.
- A `treso.valider_demande` → voit le bloc "Décision" (`ValidationActions`,
  boutons Valider/Rejeter) si `EN_ATTENTE`.
- N'a ni l'une ni l'autre — impossible en pratique : la garde du layout
  l'aurait déjà refusé.

**`validerDemandeAction(demandeId)` / `rejeterDemandeAction(demandeId, motif)`**
(dans `treso/finance/demandes/[id]/actions.ts`, à côté de
`categoriserDemandeAction`) :

- Appelées directement depuis `ValidationActions.tsx` (Client Component,
  `useTransition`) — pas de `<form action={...}>` : ce sont de simples
  fonctions serveur invoquées avec des arguments, comme les toggles de la
  console admin.
- **Verrouillage définitif** : valider passe la demande en `VALIDEE`, sans
  aucune fonction de "dévalidation" nulle part dans le portail — la seule
  façon de "défaire" une décision serait une intervention manuelle en base,
  jamais via l'application.
- **Motif obligatoire pour un rejet** (zod, `min(3)`), revérifié côté serveur
  même si le bouton "Confirmer le rejet" est aussi bloqué côté client si le
  champ est vide.
- **Défense en profondeur** (même principe que `categoriserDemandeAction`) :
  chaque action revérifie `statut === "EN_ATTENTE"` juste avant l'écriture.
  Vérifié manuellement en contournant volontairement la garde d'UI sur une
  demande déjà `VALIDEE` : la Server Action a refusé une seconde validation
  (aucune entrée `HistoriqueEntry` dupliquée, statut inchangé).
- Écriture + historisation dans une transaction Prisma (`$transaction`) :
  `Demande.update` (statut, `motifRejet` si rejet) et
  `HistoriqueEntry.create` (`action: "validation"` ou `"rejet"`, `detail`
  = motif ou `null`) réussissent ou échouent ensemble.
- `revalidatePath` sur `/treso/finance/demandes`, `/treso/finance/demandes/[id]`
  **et** `/treso/demandes` (Ticket 1) : le badge de statut se met à jour
  immédiatement partout où la demande apparaît.

**Historique générique de la demande** —
[src/components/tresorerie/DemandeHistorique.tsx](src/components/tresorerie/DemandeHistorique.tsx) :
Server Component autonome (`<DemandeHistorique demandeId={...} />`) qui
requête lui-même `HistoriqueEntry` (`entity: "Demande"`), triées par ordre
chronologique. Volontairement générique : une action sans libellé connu
dans `ACTION_LABELS` s'affiche simplement avec sa valeur brute — aucune
modification nécessaire ici quand les tickets suivants (règlements, retours
de caisse) commenceront à historiser leurs propres évènements sur la même
demande. Utilisable depuis n'importe quelle page affichant une demande, pas
seulement l'écran Finance.

**Lisibilité de l'historique (petit correctif rétroactif sur le Ticket 2)**
— en construisant l'affichage de l'historique, l'entrée "Catégorisation"
du Ticket 2 s'est révélée peu lisible (elle stockait les identifiants bruts
`categorieId`/`objetId` plutôt que des libellés). Corrigé dans
`categoriserDemandeAction` pour stocker les libellés humains
(`Catégorie « X », objet « Y », budget Z FCFA`) — les entrées créées avant
ce correctif restent inchangées en base (elles gardent les IDs bruts).

## Module Trésorerie : Ticket 4 — Règlement d'une demande validée

**Statut : terminé.**

**Fonctions de calcul** —
[src/lib/tresorerie.ts](src/lib/tresorerie.ts) :

- `getTotalRegle(demandeId)` — somme des règlements **confirmés et non
  annulés** d'une demande (un brouillon ou un règlement annulé ne compte
  jamais).
- `getResteARegler(demandeId)` — `montant demande - getTotalRegle(...)`,
  jamais négatif.
- `getSoldeCaisse()` — solde de caisse global, **toujours recalculé** à
  partir du grand livre immuable `JournalCaisse` (entrées - sorties),
  jamais saisi manuellement (règle impérative). N'alimente encore aucun
  écran : préparée pour le dashboard Finance d'un prochain ticket.

**Cycle de vie d'un `Reglement`** (`treso/finance/demandes/[id]/reglementActions.ts`,
fichier dédié séparé du `actions.ts` du Ticket 3 pour ne pas surcharger ce
dernier) :

1. **Brouillon** (`creerReglementAction`) — `estConfirme: false`. Montant
   plafonné au reste à régler (zod + revérification serveur), modifiable
   librement tant qu'il n'est pas confirmé (`modifierReglementAction`,
   mêmes contrôles que la création).
2. **Confirmation** (`confirmerReglementAction`) — défense en profondeur :
   revérifie que la demande est toujours `VALIDEE`, que le règlement n'est
   ni déjà confirmé ni annulé, et **recalcule** `getTotalRegle()` côté
   serveur avant d'accepter (jamais confiance dans le montant affiché par
   l'UI, qui a pu devenir obsolète). Si `mode = CAISSE`, crée dans la
   **même transaction** (`$transaction`) une écriture `JournalCaisse`
   (`type: "SORTIE"`, `source: "reglement_caisse"`, `refId` = id du
   règlement). Un règlement `BANQUE` ne touche jamais `JournalCaisse`.
   Plus aucune édition possible une fois confirmé (seul "Annuler" reste).
3. **Annulation** (`annulerReglementAction`, motif obligatoire, zod
   `min(3)`) — **jamais de suppression ni d'édition silencieuse** : le
   règlement passe `estAnnule: true` avec son `motifAnnulation`, mais reste
   visible dans la liste (barré, badge "Annulé"). Si le règlement annulé
   était `CAISSE`, une écriture `JournalCaisse` **compensatoire**
   (`type: "ENTREE"`, `source: "annulation_reglement_caisse"`, même
   `refId`) neutralise l'effet de la `SORTIE` d'origine — celle-ci n'est
   **jamais modifiée ni supprimée** (grand livre immuable). Le reste à
   régler remonte automatiquement puisque `getTotalRegle()` exclut les
   règlements annulés.

Chaque confirmation et chaque annulation crée une `HistoriqueEntry`
(`action: "reglement"` / `"annulation_reglement"`, `detail` = montant+mode
ou motif), ajoutées à `ACTION_LABELS` dans
[DemandeHistorique.tsx](src/components/tresorerie/DemandeHistorique.tsx)
("Règlement" / "Annulation de règlement") — confirme que ce composant
générique du Ticket 3 n'a effectivement rien demandé d'autre qu'une entrée
de libellé pour accueillir un nouveau type d'évènement.

**Section "Règlements"** (`ReglementsSection.tsx`, Server Component ;
`ReglementRow.tsx` et `ReglementForm.tsx`, Client Components) n'apparaît
que si la demande est `VALIDEE`. Le formulaire d'ajout est non contrôlé
(`defaultValue`/`FormData`, comme `CategorisationForm` du Ticket 2) — passer
`value` à `Select` entrerait en conflit avec son `defaultValue` interne.

**Piège trouvé et corrigé pendant la vérification manuelle** — `ReglementRow`
affichait ses boutons Modifier/Confirmer/Annuler à **tout** utilisateur de
l'espace Finance, y compris le DG (`treso.valider_demande` sans
`treso.effectuer_reglement`) : les Server Actions les auraient bien
refusés côté serveur, mais l'UI proposait des actions vouées à échouer.
Corrigé en ajoutant une prop `canEffectuerReglement` à `ReglementRow`,
calculée dans `page.tsx` et transmise via `ReglementsSection` — même
principe que `canCategoriser`/`canValider` du Ticket 3 : ne jamais supposer
qu'un utilisateur de l'espace Finance a toutes les permissions.

## Module Trésorerie : Ticket 5 — Déclaration d'un retour de caisse (Collaborateur)

**Statut : terminé.**

**Nouvelle route Collaborateur** —
[src/app/(dashboard)/treso/demandes/[id]/page.tsx](<src/app/(dashboard)/treso/demandes/[id]>)
est le premier écran de détail de demande côté **Collaborateur** (créateur),
distinct de `treso/finance/demandes/[id]` (Finance/DG). Accessible via un
lien "Voir" ajouté à chaque ligne de `MesDemandesTable` (Ticket 1). Garde
côté serveur : `demande.createurId !== session.user.id` →
`redirect("/treso/demandes?error=acces_refuse_demande")`, jamais seulement
l'absence de lien dans l'UI — vérifié en accédant directement à l'URL avec
un autre compte (DG) : redirection immédiate + toast d'erreur, aucune fuite
de données. Affiche le détail en lecture seule (montant, statut, catégorie/
objet si renseignés), la section "Retours de caisse" ci-dessous, et
l'historique générique (`DemandeHistorique`, Ticket 3, réutilisé tel quel).

**Déclaration toujours depuis un règlement précis** — jamais de formulaire
libre : `RetoursCaisseSection.tsx` (Server Component) liste les règlements
`CAISSE` **confirmés et non annulés** de la demande ; `RetourCaisseRow.tsx`
(Client) affiche par règlement soit son statut de retour ("En attente de
réception" / "Réceptionné"), soit un bouton "Déclarer un retour de caisse"
si aucun retour n'existe encore pour ce règlement précis.

**Choix V1 : un seul retour déclaré par règlement.** Dès qu'un
`RetourCaisse` existe pour un règlement (quel que soit son statut de
réception), le bouton de déclaration disparaît définitivement pour ce
règlement — évite les doublons sans complexité additionnelle. Si un
besoin de retours multiples par règlement apparaît plus tard, à traiter
comme une évolution dédiée (pas dans le périmètre de ce ticket).

**`creerRetourCaisseAction(reglementId, formData)`**
(`treso/demandes/[id]/retourActions.ts`) — vérifie dans l'ordre :
permission `treso.declarer_retour`, règlement existe et est
`mode: CAISSE` + `estConfirme: true` + `estAnnule: false`,
`demande.createurId === session.user.id` (un collaborateur ne peut déclarer
que sur ses propres demandes, revérifié serveur même si l'UI ne propose le
bouton qu'au bon endroit), et qu'aucun `RetourCaisse` n'existe déjà pour ce
règlement. Champs : montant dépensé, montant à retourner, justification
(`TypeJustification`), commentaire — **obligatoire uniquement si
justification = `SANS_PIECE`** (zod `.superRefine()`, testé dans les deux
sens : refusé sans commentaire, accepté avec). Crée le `RetourCaisse`
(`estReceptionne: false`) et une `HistoriqueEntry`
(`action: "declaration_retour"`).

**Règle impérative respectée et vérifiée explicitement : cette action ne
touche jamais `JournalCaisse` ni le solde de caisse.** Aucun code de
`retourActions.ts` n'importe ni n'écrit dans `JournalCaisse` — seule la
**réception** du retour par Finance (Ticket 6, à venir) impactera le solde.
Vérifié en pratique : `JournalCaisse` comptait exactement 2 lignes (une par
règlement Caisse confirmé, 30 000 + 25 000 FCFA) avant et après la
déclaration de deux retours de caisse distincts — aucune ligne
supplémentaire, `getSoldeCaisse()` strictement inchangé par la déclaration.

**Piège rencontré et corrigé pendant la vérification manuelle : le toast de
succès n'apparaissait jamais**, alors que le `RetourCaisse` était bien créé
en base. Cause : `revalidatePath()` fait remonter un `retour` non nul depuis
`RetoursCaisseSection` (Server Component) dans le **même aller-retour
réseau** que la résolution de l'état de `useActionState` — si le rendu de
`RetourCaisseForm` dépend de `!retour`, le composant est démonté par ce
rafraîchissement avant même de committer son propre état "success", et
l'effet du toast (`useActionFeedback`) ne s'exécute jamais. Corrigé dans
`RetourCaisseRow.tsx` : la présence du formulaire ne dépend plus que de
l'état local `formOpen` (jamais de `retour`) — le formulaire reste monté le
temps de committer son état "success" (toast + `onSuccess()` qui referme le
formulaire au rendu suivant), exactement comme `ReglementForm.tsx` (Ticket
4), qui ne s'est jamais démonté de l'extérieur. À retenir pour tout futur
formulaire dont la fermeture après succès dépend d'un état Serveur
revalidé : ne jamais conditionner le rendu du formulaire lui-même sur cette
donnée serveur, seulement sur un état local fermé par son propre effet.

## Module Trésorerie : Ticket 6 — Réception d'un retour de caisse (Finance)

**Statut : terminé.** Complément direct du Ticket 5 : la déclaration d'un
retour par le Collaborateur ne touche jamais `JournalCaisse` ; la
**réception** par Finance, ici, est l'unique moment où ce retour impacte
réellement le solde de caisse.

**Garde du layout Finance élargie une troisième fois** —
`treso/finance/layout.tsx` accepte désormais `treso.categoriser_demande`
**OU** `treso.valider_demande` **OU** `treso.receptionner_retour` (même
principe qu'au Ticket 3 pour la deuxième permission) : dans le seed actuel
le rôle Finance a les trois, mais la garde reste correcte par principe pour
tout futur rôle qui n'en aurait qu'une seule.

**`treso/finance/retours/page.tsx`** — "Retours en attente" : tous les
`RetourCaisse` où `estReceptionne = false`, tous collaborateurs confondus,
triés par ancienneté croissante (même convention que `finance/demandes`).
Protégée explicitement par `treso.receptionner_retour` (page elle-même,
`redirect("/?error=acces_refuse_receptionner_retour")`), jamais supposée
acquise du simple fait d'avoir passé la garde du layout partagé.

**`receptionnerRetourAction(retourId)`** (`treso/finance/retours/retourActions.ts`,
appelée directement depuis `RetoursEnAttenteTable.tsx` via `useTransition`,
comme `confirmerReglementAction` au Ticket 4 — pas de champ à valider, juste
un identifiant) :

- Vérifie `treso.receptionner_retour`, que le retour existe, et **revérifie
  `estReceptionne` juste avant d'agir** (défense en profondeur : un autre
  utilisateur Finance a pu réceptionner ce même retour entre l'affichage de
  la liste et ce clic — vérifié manuellement avec deux onglets Finance
  ouverts simultanément sur la même liste non rafraîchie : le second clic
  est refusé côté serveur avec un message explicite, aucune écriture
  `JournalCaisse` supplémentaire créée).
- Dans une **même transaction** (`$transaction`) : met à jour le
  `RetourCaisse` (`estReceptionne: true`, `receptionneParId`,
  `receptionneAt`), crée l'écriture `JournalCaisse` (`type: "ENTREE"`,
  montant = `montantARetourner`, `source: "retour_caisse_receptionne"`,
  `refId` = id du retour), et une `HistoriqueEntry` sur la **demande**
  (remontée via `RetourCaisse -> Reglement -> Demande`, puisque le retour ne
  connaît pas directement sa demande).
- `revalidatePath` sur `/treso/finance/retours`, `/treso/demandes/[demandeId]`
  et `/treso/finance/demandes/[demandeId]` : le retour disparaît
  immédiatement de la liste Finance, et le badge passe à "Réceptionné" côté
  Collaborateur sans action supplémentaire de sa part — `RetourCaisseRow.tsx`
  (Ticket 5) n'a nécessité **aucune modification** : il lisait déjà
  `estReceptionne` depuis la base pour choisir son libellé de badge.

**Cycle caisse complet, maintenant symétrique et vérifié de bout en bout** :
un règlement `CAISSE` confirmé crée une `SORTIE` (Ticket 4) ; sa déclaration
de retour (Ticket 5) ne crée **rien** ; sa réception (ce ticket) crée une
`ENTREE` de `montantARetourner` — la caisse n'est donc impactée que deux
fois par ce cycle, jamais trois, jamais à la déclaration. Vérifié
explicitement : règlement Caisse de 30 000 FCFA confirmé (`JournalCaisse` :
1 ligne `SORTIE`, solde -30 000), retour de 5 000 FCFA déclaré (`JournalCaisse`
toujours 1 ligne, solde inchangé -30 000), retour réceptionné
(`JournalCaisse` : 2 lignes, `ENTREE` de 5 000, **solde -25 000** — soit
exactement +5 000 par rapport à avant réception).

**Libellé d'historique et justification partagée** — `reception_retour`
ajouté à `ACTION_LABELS` dans
[DemandeHistorique.tsx](src/components/tresorerie/DemandeHistorique.tsx)
("Retour de caisse réceptionné"). Les libellés de `TypeJustification`
(Facture/Reçu/Ticket/Dépense sans pièce formelle), jusqu'ici définis en
dur dans `RetourCaisseForm.tsx` (Ticket 5), sont désormais factorisés dans
[src/components/tresorerie/justification.ts](src/components/tresorerie/justification.ts)
(`JUSTIFICATION_LABEL` / `JUSTIFICATION_OPTIONS`) — réutilisés par le
formulaire de déclaration et par la colonne "Justification" de la liste
"Retours en attente", même principe que `demandeStatut.ts` pour
`StatutDemande`.

**Navigation** — nouvelle entrée conditionnelle "Retours en attente"
(`/treso/finance/retours`) dans la branche "Demande d'Achat" de `nav.ts`,
gérée par un nouveau booléen `canReceptionnerRetour` dans `NavFlags`,
calculé dans `(dashboard)/layout.tsx` et descendu via `AppShell` → `Sidebar`
— même chemin de propagation que `canAccesFinanceDemandes` (Ticket 2) et
`canAdmin`. Vérifié qu'un compte sans `treso.receptionner_retour` (DG) ne
voit ni le lien dans la sidebar, ni n'accède à `/treso/finance/retours` en
URL directe (redirection + toast).

## Module Trésorerie : Ticket 7 — Régularisation et clôture d'une demande

**Statut : terminé.** Ce ticket referme le cycle métier complet du Module
Trésorerie : demande → catégorisation → validation → règlement → retour →
réception → **clôture**.

**Formules de régularisation** (`src/lib/tresorerie.ts`) :

- `getDepensesDeclarees(demandeId)` — somme de `montantDepense` sur **tous**
  les `RetourCaisse` liés aux règlements de la demande, réceptionnés ou non
  : c'est ce que le collaborateur affirme avoir dépensé, indépendamment du
  traitement de Finance.
- `getRetoursRecus(demandeId)` — somme de `montantARetourner`, **uniquement**
  sur les retours `estReceptionne: true` : l'argent réellement revenu en
  caisse.
- `getEcart(demandeId)` = `getTotalRegle() - getDepensesDeclarees() -
  getRetoursRecus()`. Un écart de 0 signifie que tout l'argent décaissé est
  justifié. Un écart positif n'est **pas nécessairement un blocage** — c'est
  une information affichée à Finance au moment de la clôture ; la clôture
  partielle sert justement à l'acter avec un motif.

**Composant partagé** —
[src/components/tresorerie/RegularisationSummary.tsx](src/components/tresorerie/RegularisationSummary.tsx)
(Server Component autonome, purement informatif) affiche les 4 chiffres et
met l'écart en évidence (`text-success` si nul, `text-warning` sinon — même
convention que le "Reste à régler" du Ticket 4). Réutilisé tel quel à trois
endroits pour ne jamais dupliquer ce calcul : section "Régularisation" côté
Finance (demande `VALIDEE`, actionnable) ou en lecture seule (demande
clôturée), et section "Situation finale" côté Collaborateur (Ticket 5,
demande clôturée).

**Clôture totale vs partielle** (`cloturerDemandeAction(demandeId, type,
motif?)` dans `treso/finance/demandes/[id]/actions.ts`, appelée directement
depuis `ClotureActions.tsx` via `useTransition`, comme
`validerDemandeAction`/`rejeterDemandeAction`) :

- Réservée à `treso.cloturer_demande` (Finance uniquement selon le seed
  actuel, **pas le DG**) — revérifiée dans la Server Action, jamais
  supposée acquise du simple fait d'avoir passé la garde du layout Finance
  partagé. Vérifié manuellement : le DG voit la section Régularisation
  (information) mais aucun bouton de clôture.
- Uniquement sur une demande `VALIDEE` (défense en profondeur : revérifié
  juste avant l'écriture, comme toutes les transitions de statut du
  module).
- **Totale** : motif libre optionnel (simple commentaire, stocké dans
  `Demande.motifCloture`, aucune validation de longueur).
- **Partielle** : motif **obligatoire** (zod, min 3 caractères), refusé
  côté serveur sans lui, même si le bouton de confirmation est aussi
  bloqué côté client si le champ est vide.
- Verrouillage **définitif** (même principe que la validation, Ticket 3) :
  `Demande.statut` passe à `CLOTUREE_TOTALE` ou `CLOTUREE_PARTIELLE`, et il
  n'existe aucune fonction de "déclôture" dans le portail. Écriture +
  `HistoriqueEntry` (`action: "cloture_totale"` / `"cloture_partielle"`,
  `detail` = motif si partielle, sinon un résumé de l'écart constaté) dans
  une transaction Prisma.

**Défense en profondeur étendue à toutes les actions du cycle caisse** —
règle impérative : une fois clôturée, plus aucune action n'est possible sur
la demande. `creerReglementAction` (Ticket 4) vérifiait déjà
`demande.statut === "VALIDEE"`. Trois failles ont été trouvées et corrigées
à l'occasion de ce ticket, car `estConfirme`/`estAnnule`/`estReceptionne`
ne changent jamais après une clôture — ces champs seuls ne suffisaient pas
à bloquer l'accès :

- `creerRetourCaisseAction` (Ticket 5) — revérifie maintenant aussi
  `reglement.demande.statut === "VALIDEE"`.
- `receptionnerRetourAction` (Ticket 6) — revérifie maintenant aussi
  `retour.reglement.demande.statut === "VALIDEE"` : un retour resté en
  attente au moment d'une clôture partielle ne peut plus jamais être
  réceptionné ensuite (l'écart constaté est acté par le motif de clôture,
  pas rattrapable après coup).
- `annulerReglementAction` (Ticket 4) — même correctif, par cohérence.

Vérifié manuellement avec un scénario réaliste (deux onglets ouverts avant
clôture, formulaires pré-remplis mais non soumis, clôture déclenchée dans
un troisième onglet, puis soumission des formulaires restés ouverts) : les
deux tentatives sont refusées côté serveur avec un message explicite
("Cette demande n'est pas validée : aucun règlement possible." /
"Cette demande n'est plus modifiable (statut actuel : CLOTUREE_TOTALE)."),
et aucune ligne supplémentaire n'apparaît en base (règlement et retour
inchangés après les deux tentatives).

**Bonus UX (pas de défense en profondeur, juste éviter une action vouée à
l'échec)** : la liste "Retours en attente" (Ticket 6) exclut désormais les
retours dont la demande n'est plus `VALIDEE`, et `RetourCaisseRow.tsx`
(Ticket 5, vue Collaborateur) masque le bouton "Déclarer un retour de
caisse" une fois la demande clôturée (`peutDeclarer`, badge "Non déclaré"
à la place) — même principe que `canEffectuerReglement` au Ticket 4.

**Écrans Finance et Collaborateur une fois clôturée** — la page Finance
(`treso/finance/demandes/[id]/page.tsx`) gagne une branche dédiée aux
statuts `CLOTUREE_TOTALE`/`CLOTUREE_PARTIELLE` : bandeau de verrouillage,
catégorisation en lecture seule, `RegularisationSummary` en lecture seule
(aucun bouton), motif affiché si clôture partielle. Elle ne rend plus du
tout `ReglementsSection` (déjà exclu par la structure en branches
`if`/`else if` sur le statut, sans code supplémentaire) : "plus de section
Règlements/Retours actionnable" découle naturellement du fait qu'on ne
passe plus jamais dans la branche `VALIDEE`. Côté Collaborateur
(`treso/demandes/[id]/page.tsx`), une section "Situation finale" identique
apparaît au même titre, avec un bandeau "Ce dossier est clôturé...".

**`revalidateDemandePaths` complété** — ce helper partagé (categoriser/
valider/rejeter/cloturer) revalidait `/treso/finance/demandes`,
`/treso/finance/demandes/[id]` et `/treso/demandes`, mais **pas**
`/treso/demandes/[id]` (la page Collaborateur du Ticket 5, qui n'existait
pas encore au moment où ce helper a été écrit au Ticket 3). Corrigé ici :
profite rétroactivement à `validerDemandeAction`/`rejeterDemandeAction`
aussi, qui reflètent désormais le nouveau statut sans délai sur la page
Collaborateur.

**Badges de statut** — `CLOTUREE_TOTALE` ("Clôturée", `neutral`) et
`CLOTUREE_PARTIELLE` ("Clôturée (partielle)", `info`) étaient déjà
correctement définis dans `demandeStatut.ts` depuis le Ticket 1 (prévus par
avance) : aucune modification nécessaire pour ce ticket.

**Vérifié explicitement (deux scénarios de bout en bout)** :

- **Clôture totale, écart nul** : règlement Caisse 30 000 FCFA confirmé,
  retour de 5 000 FCFA déclaré puis réceptionné → décaissé 30 000, dépenses
  25 000, retours reçus 5 000, **écart 0** (affiché en vert). Clôture
  totale réussie sans motif. Verrouillage confirmé (plus de section
  Règlements/Clôture actionnable) et vue Collaborateur "Situation finale"
  cohérente des deux côtés.
- **Clôture partielle, écart positif** : règlement Caisse 20 000 FCFA
  confirmé, retour de 3 000 FCFA déclaré mais **laissé en attente de
  réception** → dépenses 15 000, retours reçus 0, **écart 5 000** (affiché
  en orange). Clôture partielle sans motif refusée côté client ET aurait
  été refusée côté serveur ; avec motif ("Justificatif manquant pour 5000
  FCFA, collaborateur injoignable.") acceptée, motif visible à l'identique
  côté Finance et côté Collaborateur.

## Module Trésorerie : Ticket 8 — Dashboard Finance

**Statut : terminé.**

**Fonctions d'agrégation** (`src/lib/dashboardFinance.ts`, distinct de
`tresorerie.ts` pour ne pas le surcharger) :

- `getDemandesADecaisser()` / `getDecaissementsARegulariser()` — répartissent
  les demandes `VALIDEE` en deux ensembles selon leur reste à régler
  (`> 0` / `= 0`), calculés en **2 requêtes groupées** (`findMany` +
  `reglement.groupBy({ by: ["demandeId"] })`) partagées par une fonction
  interne commune, **jamais une requête `getResteARegler()` par demande** —
  le volume de demandes validées à un instant T reste modeste pour une
  application interne, mais autant éviter le N+1 dès que c'est simple.
- `getRetoursEnAttente()` — compte les `RetourCaisse` non réceptionnés dont
  la demande est toujours `VALIDEE`, via `RETOUR_EN_ATTENTE_WHERE` : ce
  filtre Prisma est **exporté et réutilisé tel quel** par
  `treso/finance/retours/page.tsx` (Ticket 6), pour que le chiffre du
  dashboard et la liste sur laquelle on atterrit en cliquant dessus
  désignent toujours exactement le même ensemble de lignes.
- `getSoldeCaisse()` (Ticket 4) est réutilisée telle quelle, sans
  modification.

Les deux listes filtrées (`treso/finance/a-decaisser/page.tsx` et
`.../a-regulariser/page.tsx`) recalculent la même répartition
groupée pour afficher le détail ligne par ligne (référence, créateur,
montant, reste à régler ou écart, date de validation — `Demande.updatedAt`,
qui correspond exactement à la date de validation tant que la demande
reste `VALIDEE`, aucun autre champ de `Demande` ne changeant après coup).
Sur `a-regulariser`, l'écart par demande (`getEcart()`, Ticket 7) est
calculé **par demande** via `Promise.all` plutôt qu'en une requête groupée
supplémentaire : contrairement à "toutes les demandes validées", cet
ensemble est par nature une file d'attente opérationnelle bornée (demandes
déjà entièrement réglées, en attente de clôture), donc son volume reste
modeste même pour une application interne active.

**Aucune mise en cache applicative des indicateurs** : chaque fonction
interroge Prisma directement à chaque appel, sans mémoïsation ni `unstable_cache`
— la fraîcheur "temps réel" repose entièrement sur `revalidatePath`, jamais
sur un TTL. **Toutes les Server Actions qui changent l'état d'une demande,
d'un règlement ou d'un retour** (`confirmerReglementAction`,
`annulerReglementAction`, `creerReglementAction`/`modifierReglementAction`
via le même helper, `creerRetourCaisseAction`, `receptionnerRetourAction`,
`categoriserDemandeAction`/`validerDemandeAction`/`rejeterDemandeAction`/
`cloturerDemandeAction` via `revalidateDemandePaths`) appellent désormais
`revalidatePath("/treso/finance", "layout")` en plus des chemins déjà
revalidés — le second argument `"layout"` invalide **toute** la sous-arborescence
partageant `finance/layout.tsx` (dashboard, `a-decaisser`, `a-regulariser`,
`retours`, `demandes`) en un seul appel, plutôt que d'énumérer chaque
sous-route une par une à chaque action. Vérifié manuellement : un règlement
confirmé dans un onglet fait apparaître le nouveau reste à régler dans un
**second onglet** déjà ouvert sur le dashboard, sur la **navigation
suivante** vers cette page (clic sur un lien, ou `router.refresh()`) —
`revalidatePath` invalide le cache serveur, il ne pousse pas la mise à jour
vers un onglet resté statique sans revenir sur la route, comportement
standard déjà en vigueur sur tout le reste du portail.

**Écran** (`treso/finance/page.tsx`) — `PageHeader` + 4 `StatCard`
(composants déjà fournis par le maître de stage, réutilisés tels quels,
aucune carte recréée à la main) :

| Indicateur | Icône | Ton | Cliquable vers |
|---|---|---|---|
| Solde de caisse | `wallet` | `success` | — |
| Demandes à décaisser | `file-text` | `info` | `/treso/finance/a-decaisser` |
| Décaissements à régulariser | `book-text` | `neutral` | `/treso/finance/a-regulariser` |
| Retours de caisse en attente | `rotate-ccw` | `warning` | `/treso/finance/retours` (Ticket 6) |

Ce mapping icône/ton reprend **exactement** le bloc d'indicateurs
« indicatifs » déjà présent sur le tableau de bord général
(`(dashboard)/page.tsx`, commentaire "valeurs indicatives tant que le
module Trésorerie n'est pas câblé") : ce placeholder préfigurait très
précisément cet écran (même libellé et mêmes icône/ton pour "Retours de
caisse en attente"). **Ce placeholder général n'a pas été touché** (hors
périmètre de ce ticket) — le câbler sur ces mêmes fonctions, ou le
remplacer par un lien vers ce dashboard, est une suite naturelle à évaluer
avec le maître de stage.

**Piège de navigation trouvé et corrigé pendant la vérification manuelle** —
ajouter un item de nav dont l'`href` (`/treso/finance`) est un **préfixe
strict** d'autres items déjà existants (`/treso/finance/demandes`,
`/treso/finance/retours`) aurait fait s'allumer **simultanément** "Tableau
de bord Finance" et l'item réellement actif sur toute sous-route Finance,
`isActive()` (dans `Sidebar.tsx`) utilisant un simple `pathname.startsWith(href + "/")`.
Corrigé en ajoutant un champ `exact?: boolean` à `NavItem` (`nav.ts`) —
posé sur ce nouvel item uniquement — et en faisant respecter ce flag dans
`isActive()`, en plus du cas déjà spécial de `href === "/"`. À réutiliser
pour tout futur item de nav dont l'`href` serait le préfixe d'un autre.

**Navigation** — "Tableau de bord Finance" (`layout-grid`, `exact: true`)
ajouté **en tête** de la branche "Demande d'Achat" dans `nav.ts`, visible
avec le nouveau booléen `canVoirDashboardFinance` (`NavFlags`), propagé
comme les précédents via `(dashboard)/layout.tsx` → `AppShell` → `Sidebar`.

**Garde du layout Finance étendue une quatrième fois** — accepte désormais
aussi `treso.voir_dashboard_finance`, par le même principe que les
extensions précédentes (Tickets 3 et 6) : correcte par principe pour tout
futur rôle qui n'aurait que cette permission, même si Finance/DG ont
toujours au moins une autre permission qui suffirait à elle seule.

**Vérifié explicitement** : base à zéro (0 partout) avant création des
données de test. Après une demande de 40 000 FCFA réglée à 15 000 FCFA
(Caisse) et une demande de 30 000 FCFA entièrement réglée avec un retour de
2 000 FCFA déclaré mais non réceptionné → solde -45 000, "Demandes à
décaisser" 1 (25 000 FCFA — le reste à régler, pas les 40 000 du montant
total), "Décaissements à régulariser" 1 (30 000 FCFA), "Retours en
attente" 1. Chaque indicateur cliqué mène à la bonne ligne dans sa liste
filtrée. Confirmation d'un second règlement de 25 000 FCFA sur la première
demande (son reste tombe à 0) : le dashboard rouvert dans un second onglet
(nouvelle navigation, sans F5) passe correctement à solde -70 000,
"Demandes à décaisser" 0, "Décaissements à régulariser" 2 (70 000 FCFA).
Le compte collaborateur ne voit ni le lien ni l'accès direct à
`/treso/finance` (redirection + toast). Toutes les données de test
supprimées, les 4 indicateurs reviennent exactement à zéro.

## Module Trésorerie : Ticket 9 — Reçu PDF par règlement

**Statut : terminé.**

**Librairie retenue : `@react-pdf/renderer`** (aucune librairie PDF n'était
présente dans le projet — installée pour ce ticket). Choisie parce qu'elle
permet d'écrire le gabarit en JSX (`Document`/`Page`/`View`/`Text`,
`StyleSheet.create`), fonctionne nativement dans un Route Handler Next.js
(rendu 100% serveur, `renderToBuffer()`), et n'a pas besoin d'un navigateur
headless (contrairement à une approche Puppeteer/Chromium).

**Champ manquant trouvé et corrigé avant même d'écrire le gabarit** —
`Reglement` n'avait que `createdAt` (date de création du **brouillon**),
aucune date de confirmation. Le cahier des charges exige explicitement la
date de confirmation sur le reçu, jamais celle du brouillon. Migration
Prisma ajoutée : `Reglement.confirmeAt DateTime?` (même convention de
nommage que `RetourCaisse.receptionneAt`), renseigné dans
`confirmerReglementAction` (Ticket 4) au moment précis de la confirmation.
Migration `20260828225240_add_confirme_at_reglement`.

**Police Montserrat côté PDF — fichiers bundlés localement, pas d'URL
distante** (corrigé lors d'un audit de conformité ultérieur). Choix initial :
`Font.register()` pointait les URLs statiques versionnées de
`fonts.gstatic.com` (mêmes fichiers que `next/font/google` télécharge à la
compilation pour le reste du portail). **Deux incidents constatés en
vérification manuelle** ont invalidé ce choix : (1) un `ConnectTimeoutError`
réseau ponctuel au premier rendu a suffi à faire échouer `Font.register`
pour **toute la durée de vie du process** (react-pdf ne retente jamais un
chargement de police en échec) — un fetch réseau à chaque génération de PDF
est fondamentalement fragile pour une fonctionnalité de production ; (2)
une première correction via `path.join(__dirname, ...)` a échoué à son
tour : Turbopack réécrit `__dirname` vers un chemin racine virtuel
(`C:\ROOT\...`) qui n'existe pas sur le disque réel. Solution retenue : les
4 fichiers `.ttf` (400/500/600/700) sont commités dans
`src/lib/pdf/fonts/`, lus en `Buffer` une seule fois au chargement du
module via `path.join(process.cwd(), "src/lib/pdf/fonts")` (`process.cwd()`
est toujours la racine du projet pour `next dev`/`next start`, jamais
virtualisé par le bundler), puis encodés en data URL base64 passée à `src`
(`@react-pdf/font` accepte nativement ce format) — les données de police
vivent entièrement en mémoire après le premier chargement du module,
aucune dépendance réseau ni résolution de chemin fragile au moment du
rendu. **Point de vigilance pour un build de production** : cette approche
suppose que `process.cwd()` reste la racine du projet ; à revérifier si le
déploiement change ce répertoire de travail (ex: mode `standalone`).

**Mise à jour Phase E** : ce chargement de police est désormais factorisé
dans `src/lib/pdf/registerFonts.ts` (partagé avec le nouveau bon de
caisse). Un bug latent de `formatMontant` (espace fine insécable absente
des glyphes de cette police, montants mal rendus) affectait aussi ce reçu
depuis l'origine — corrigé dans `src/lib/pdf/format.ts`, voir la section
"Phase E — Bon de caisse" pour le détail complet.

**Pas de logo image** — `logo-sim-blanc.webp` pose deux problèmes distincts
pour ce reçu : (1) format WebP non fiablement supporté par le moteur de
rendu image de @react-pdf/renderer, et (2) c'est une version blanche pensée
pour un fond bleu plein. Le bandeau d'en-tête du reçu **est** bleu
(`sim-blue-dark`), donc le problème de contraste ne se serait pas posé ici,
mais le format reste bloquant. Choix (comme anticipé dans la demande) :
"SIM ASSURANCES" en texte stylé (Montserrat 700, lettres espacées, blanc
sur bleu) plutôt qu'une image. Une vraie version du logo (SVG ou PNG) réglerait
ce point pour de futurs documents PDF — hors périmètre de ce ticket.

**Palette dupliquée en hexadécimal littéral** dans `ReceiptDocument.tsx` —
@react-pdf/renderer ne lit pas les classes Tailwind/tokens CSS du projet ;
les valeurs (`#004b9c`, `#1d78ab`/`#f1f9fd`/`#cbe7f6` pour le badge Caisse,
`#475569`/`#f1f5f9`/`#e2e8f0` pour Banque...) sont recopiées **telles
quelles** depuis `globals.css`, jamais réinventées, pour un rendu
visuellement identique aux tokens `info`/`neutral` déjà utilisés partout
ailleurs dans l'application.

**Route** `GET /api/treso/reglements/[id]/recu`
(`src/app/api/treso/reglements/[id]/recu/route.tsx` — extension `.tsx` : le
handler contient du JSX pour instancier `<ReceiptDocument />`, Next.js
reconnaît `route` comme nom de fichier spécial quelle que soit l'extension
`.ts`/`.tsx`) :

- 401 si non authentifié ; 404 si le règlement n'existe pas **ou** n'est
  pas confirmé (un brouillon n'a pas de reçu — pas encore un paiement réel) ;
  403 si authentifié mais ni Finance/DG ni créateur de la demande.
- Autorisé : n'importe laquelle des permissions `treso.effectuer_reglement`
  / `treso.categoriser_demande` / `treso.valider_demande` /
  `treso.receptionner_retour` / `treso.voir_dashboard_finance` (en clair,
  Finance ou DG), **OU** `demande.createurId === session.user.id` (le
  collaborateur voit le reçu de son propre décaissement, jamais celui d'un
  tiers).
- **Référence du reçu** = référence de la demande + rang du règlement parmi
  les règlements confirmés de cette demande, dans l'ordre de création (ex:
  `DEM-2026-000123-R1`, `-R2`...) — dérivée, sans nouveau champ en base.
- `Content-Disposition: attachment; filename="recu-DEM-2026-000123-R1.pdf"`.

**Contenu complet du reçu** (section "Situation de la demande" ajoutée lors
d'un audit de conformité, le reste dès la version initiale) : référence de
la demande, date du règlement, montant réglé (ce règlement précis), mode
(badge Caisse/Banque), demandeur, catégorie, objet, auteur du règlement,
référence du reçu — **plus, dans une section dédiée, l'état le plus à jour
de la demande au moment de la génération** (pas figé à la date de ce
règlement) : montant demandé (`Demande.montant`), total réglé à ce jour
(`getTotalRegle(demandeId)`) et reste à régler
(`getResteARegler(demandeId)`, vert si nul, orange sinon — même convention
que "Reste à régler" ailleurs dans l'app). Un même règlement téléchargé à
deux moments différents peut donc afficher un reste à régler différent si
d'autres règlements sont intervenus depuis sur la même demande.

**Boutons "Télécharger le reçu"** — sur `ReglementRow.tsx` (Finance,
Ticket 4) pour tout règlement `estConfirme && !estAnnule`, **sans condition
sur `canEffectuerReglement`** : la route autorise déjà n'importe quelle
permission Finance/DG, donc masquer le lien pour le DG (qui n'a pas
`effectuer_reglement` mais passe la garde du layout Finance) serait
incohérent avec ce que le serveur accepterait réellement — contrairement à
"Confirmer"/"Annuler", qui restent des actions réservées. Côté
Collaborateur, aucune liste "Règlements" n'existait encore sur
`treso/demandes/[id]/page.tsx` (Ticket 5) : nouveau
`ReglementsRecusSection.tsx` (Server Component, purement en lecture seule)
ajouté, listant les mêmes règlements confirmés et non annulés avec
montant/mode/date et le même bouton, pointant vers la même route.

**Vérifié explicitement** : règlement Caisse de 30 000 FCFA confirmé sur une
demande catégorisée (Fournitures / objet renseigné) — le PDF téléchargé par
Finance contient exactement la référence de la demande, le nom du
demandeur, la catégorie et l'objet, le montant (30 000 FCFA), le mode
(badge "Caisse"), la date du règlement, la référence du reçu
(`DEM-2026-000001-R1`) et l'auteur du règlement ; relu directement (extraction
de texte du PDF) pour confirmer chaque champ. Le même reçu téléchargé par
le collaborateur créateur de la demande réussit à l'identique (PDF de même
taille en octets). Un second compte collaborateur créé spécifiquement pour
ce test (non créateur, sans permission Finance) reçoit **403**. Une requête
sans cookie de session reçoit **401**. Le DG (Finance/DG mais pas créateur)
reçoit **200** — autorisé par design, comme documenté ci-dessus. Un
règlement créé en brouillon (jamais confirmé) sur une demande dédiée : le
bouton n'apparaît nulle part dans l'UI, **et** une requête directe et
authentifiée vers sa route de reçu renvoie **404** — la défense en
profondeur ne repose pas que sur l'absence du bouton. Toutes les données de
test (demandes, second compte collaborateur) supprimées après vérification.

**Audit de conformité — vérifié explicitement** : reçu téléchargé pour une
demande `CLOTUREE_TOTALE` (montant 25 000 FCFA, entièrement réglée par un
unique règlement Caisse de 25 000 FCFA) — la section "Situation de la
demande" affiche Montant demandé 25 000 FCFA, Total réglé à ce jour
25 000 FCFA, Reste à régler 0 FCFA (en vert), cohérent avec l'état affiché
au même moment sur l'écran Finance. Mise en page relue : la nouvelle
section s'insère proprement entre les informations du règlement et le
détail de la demande, sans rogner ni chevaucher le reste du contenu.

## Module Trésorerie : Ticket 10 — Reporting et Export

**Statut : terminé. Dernier ticket du backlog initial du Module Trésorerie.**

**Champ `User.service` ajouté (choix d'architecture, pas un détail)** — le
cahier des charges demande un filtre par "service", mais `User` n'avait
aucun champ de ce type. Vérifié explicitement qu'il n'avait pas été ajouté
entre-temps par ailleurs : absent. Ajouté via migration Prisma
(`20260829000309_add_service_user`) : `service String?`, texte libre
optionnel, **pas** de table de référence dédiée (`Service` avec ses propres
lignes) — le volume de services distincts reste faible pour une
application interne, une V1 en texte simple suffit ; à revoir si un jour un
vrai référentiel RH doit piloter cette liste. Seed mis à jour avec une
valeur d'exemple par compte de test : `collaborateur@` → "Commercial",
`finance@` → "Finance", `dg@` → "Direction", `rh@` → "Ressources Humaines",
`admin@` → aucun (l'Admin est un compte du Socle, pas un service métier).

**Module partagé `src/lib/reporting.ts`** — filtres et requêtes utilisés
**à l'identique** par l'écran et par l'export Excel, jamais deux
implémentations séparées des mêmes données :

- `parseReportingFilters(searchParams)` — parse les filtres depuis les
  search params de l'URL (période `du`/`au`, `demandeurId`, `service`,
  `categorieId`, `objetId`, `mode`, `statut`) ; `au` traité comme fin de
  journée incluse (23:59:59.999).
- `getReportingRows(filters)` — tableau agrégé par Catégorie puis Objet,
  **six colonnes de montants exigées par le cahier des charges** (section 15,
  complétées lors d'un audit de conformité) + le nombre de demandes et le
  budget alloué cumulé (Tâche 2) :
  - **Demandé** — somme des montants de **toutes** les demandes du groupe
    correspondant aux filtres, quel que soit leur statut (y compris
    `REJETEE` et `EN_ATTENTE`). Convention documentée ici : c'est la colonne
    qui répond à "combien a-t-on demandé au total", par opposition aux
    colonnes suivantes qui ne comptent que ce qui a réellement avancé.
  - **Validé** — somme des montants des demandes ayant au moins atteint
    `VALIDEE` (`VALIDEE`, `CLOTUREE_TOTALE` ou `CLOTUREE_PARTIELLE`). Une
    demande `REJETEE` ne contribue **jamais** à cette colonne.
  - **Réglé** — somme de tous les règlements confirmés et non annulés
    (Caisse + Banque confondus) des demandes du groupe.
  - **Reste à régler** — `max(0, Validé - Réglé)`, jamais négatif.
  - **Réglé Caisse** / **Réglé Banque** — même somme que "Réglé", ventilée
    par mode. Invariant garanti pour **chaque ligne** : `Réglé = Réglé
    Caisse + Réglé Banque`.

  Calculé en **une requête `findMany` + un seul `groupBy` par
  `["demandeId", "mode"]`** (`getMontantsRegleParDemande`), jamais une
  requête par demande. **Piège évité lors de la correction** : si `mode`
  est filtré, ce filtre ne sert **qu'à sélectionner quelles demandes
  apparaissent** (celles ayant au moins un règlement confirmé de ce mode
  précis) — il ne tronque plus les montants "Réglé"/"Réglé Caisse"/"Réglé
  Banque" d'une demande déjà retenue, contrairement à une première version
  où filtrer par Caisse aurait rendu "Réglé Banque" incohérent avec "Réglé".
- `getReportingDemandesDetail` / `getReportingReglementsDetail` /
  `getReportingRetoursDetail` / `getReportingJournalDetail` — les listes
  détaillées des 4 premières feuilles de l'export, dérivées du **même**
  ensemble de demandes filtrées que `getReportingRows` (fonction interne
  `getDemandesFiltrees` partagée). Le journal de caisse est **délibérément
  filtré uniquement par période** (jamais par catégorie/objet/mode), comme
  demandé : une écriture `JournalCaisse` n'a pas de catégorie.

**Écran** (`treso/finance/reporting/page.tsx`, protégé par
`treso.voir_reporting`) : formulaire de filtres en **GET natif**
(`ReportingFiltersForm.tsx`, `<form method="get">`, pas de Server Action) —
l'URL résultante reste partageable/rechargeable telle quelle, comme
demandé. Cascade Catégorie → Objet en mémoire côté client, même principe
que `CategorisationForm.tsx` (Ticket 2), à une différence près : l'Objet
n'est **pas verrouillé** tant qu'aucune catégorie n'est choisie (c'est un
filtre, pas une saisie — on peut vouloir filtrer directement par objet).
Tableau agrégé avec ligne de "Total général", puis section "Suivi
budgétaire" (Tâche 2) ne listant que les groupes où au moins une demande a
un `budgetDisponible` renseigné, écart mis en évidence (`text-danger` si
le réglé dépasse le budget alloué, `text-success` sinon).

**Export Excel** (`api/treso/reporting/export/route.ts`, `treso.voir_reporting`,
401/403) — librairie **`exceljs`** (choisie car elle gère nativement
plusieurs feuilles et une mise en forme basique, contrairement à des
alternatives plus légères mono-feuille). Mêmes query params et mêmes
fonctions de `reporting.ts` que l'écran : le classeur téléchargé désigne
toujours exactement les mêmes données que ce qui est affiché à l'écran
pour un même jeu de filtres. **6 feuilles**, en-tête bleu institutionnel
(`#004B9C`, texte blanc, mêmes valeurs hex que `globals.css`) :

| Feuille | Contenu |
|---|---|
| Demandes | Référence, créateur, service, catégorie, objet, montant, statut, date |
| Règlements | Référence demande, montant, mode, date de confirmation, auteur |
| Retours de caisse | Référence demande, montant dépensé, montant à retourner, justification, statut (Réceptionné/En attente), date |
| Journal de caisse | Type, montant, source, date — filtré par période uniquement |
| Reporting | Le tableau agrégé de l'écran (Demandé/Validé/Réglé/Reste à régler/Réglé Caisse/Réglé Banque), avec sa ligne "Total général" |
| Suivi budgétaire | Budget alloué / montant réglé / écart, écart négatif (dépassement) en rouge |

Bouton "Exporter en Excel" sur l'écran : lien simple (`<a href=...>`)
reconstruisant la query string des filtres actifs
(`reportingFiltersToQueryString`), nom de fichier
`reporting-tresorerie-{date}.xlsx`.

**Navigation** — "Reporting" (icône `download`, même icône que "Reporting"
côté Pointage RH dans `nav.ts`, pour la cohérence des deux modules) ajouté
dans la branche "Demande d'Achat", visible avec le nouveau booléen
`canVoirReporting` (`NavFlags`), propagé comme les précédents via
`(dashboard)/layout.tsx` → `AppShell` → `Sidebar`.

**Garde du layout Finance étendue une cinquième fois** — accepte désormais
aussi `treso.voir_reporting`, même principe que les quatre extensions
précédentes (Tickets 3, 6, 8) : correcte par principe pour tout futur rôle
qui n'aurait que cette permission.

**Vérifié explicitement** : jeu de données varié (2 catégories —
Déplacements et Carburant —, un règlement Caisse et un règlement Banque, un
retour réceptionné et un retour en attente, un cas de dépassement
budgétaire délibéré : budget 45 001 FCFA pour 65 000 FCFA réglés). Le
tableau agrégé et son export Excel affichent des totaux strictement
identiques (3 demandes, 85 000 FCFA demandé, 85 000 FCFA réglé) ; les 6
feuilles existent avec des données cohérentes (le journal de caisse ne
montre que 2 SORTIE + 1 ENTREE, aucune écriture pour le règlement Banque —
règle impérative déjà vérifiée aux Tickets 4 et 6, reconfirmée ici via
l'export). Le filtre par catégorie a été vérifié individuellement (ne
laisse apparaître que "Carburant" avec ses propres totaux), de même pour
le filtre par statut et par période (une période antérieure à la création
des données ne retourne aucune ligne). Le compte collaborateur (sans
`treso.voir_reporting`) ne voit ni le lien ni n'accède à la page
(redirection + toast) ni à la route d'export (403). Toutes les données de
test nettoyées, serveur arrêté.

**Audit de conformité — vérifié explicitement** (jeu de données couvrant
les 4 statuts distincts : `REJETEE`, `VALIDEE` non réglée, `VALIDEE`
partiellement réglée avec mélange Caisse/Banque, `CLOTUREE_TOTALE`) :

| Groupe | Nb | Demandé | Validé | Réglé | Reste | Caisse | Banque |
|---|---|---|---|---|---|---|---|
| Carburant / Carburant véhicule de liaison | 2 | 75 000 | 75 000 | 55 000 | 20 000 | 45 000 | 10 000 |
| Déplacements / Déplacement équipe commerciale | 2 | 35 000 | 15 000 | 0 | 15 000 | 0 | 0 |
| **Total général** | **4** | **110 000** | **90 000** | **55 000** | **35 000** | **45 000** | **10 000** |

La demande `REJETEE` (20 000 FCFA, groupe Déplacements) contribue à
"Demandé" (35 000 = 20 000 + 15 000) mais **pas** à "Validé" (15 000, la
seule demande `VALIDEE` du groupe), confirmant que la colonne "Demandé"
inclut délibérément tous les statuts tandis que "Validé"/"Réglé" filtrent
strictement. Export Excel (feuille "Reporting") relu programmatiquement :
chiffres strictement identiques à l'écran, ligne par ligne et sur le total
général. Toutes les données de test nettoyées, serveur arrêté.

**Avec ce ticket, le backlog initial du Module Trésorerie (Tickets 1 à 10)
est entièrement complété** — sections 2 à 15 du cahier des charges :
demande → catégorisation → validation → règlement → retour → réception →
clôture → dashboard → reçu PDF → reporting/export.

## Module Pointage RH : fondations de données

**Statut : tickets 1 et 2 implémentés.** Les modèles, enums, module,
permissions et rôle sont en place dans le schéma. Le parcours collaborateur
est disponible à `/pointage` et la destination du QR code à `/pointage/qr`.
Les pointages et les scans QR authentifiés sont journalisés dans
`HistoriqueEntry`.

Modèles (dans [prisma/schema.prisma](prisma/schema.prisma), section
"MODULE 2 — POINTAGE RH") :

- **`ParametrageHoraire`** — horaires de référence (`07:45-12:15` /
  `13:15-16:45` par défaut), paramétrables par RH
  (`pointage.gerer_horaires`). Une seule ligne active en pratique, mais le
  modèle n'impose pas d'unicité — à trancher côté écran RH si plusieurs
  lignes doivent pouvoir coexister (historique de configurations, etc.).
- **`Pointage`** — un enregistrement d'arrivée ou de départ
  (`TypePointage`), avec sa source (`SourcePointage` : `QR_CODE`,
  `ORDINATEUR`, ou `RH_EXCEPTIONNEL`). `estRetard`/`minutesRetard`/`motif`
  ne sont pertinents que pour une arrivée (`type = ARRIVEE`) — à valider
  côté logique applicative, le schéma ne le contraint pas en base.
  `effectuePar` n'est renseigné que si `source = RH_EXCEPTIONNEL` (RH a
  pointé à la place du collaborateur).
- **`CorrectionPointage`** — trace obligatoire de toute correction d'un
  `Pointage` (ancienne valeur, nouvelle valeur, motif, auteur). Reprend
  exactement le principe de la règle 5 de Trésorerie : **jamais d'édition
  silencieuse d'un pointage**, toujours une ligne de correction associée.
- **`Absence`** — une journée d'absence pour un employé, avec un statut
  (`StatutAbsence` : `A_CONTROLER` par défaut, `CONFIRMEE`, `JUSTIFIEE`) et
  qui l'a contrôlée (`controlePar`, optionnel tant que non traitée).

Relations `User` ajoutées (même convention de nommage explicite que pour
Trésorerie, ex. `"DemandeCreateur"`) : `pointagesEffectues` (pointages de
l'employé lui-même), `pointagesRealises` (pointages exceptionnels
effectués par un RH pour autrui), `correctionsEffectuees`,
`absencesDeclarees` (absences de l'employé), `absencesControlees`
(absences que l'employé — RH ou DG — a contrôlées).

Module et permissions (seed) :

- Module `pointage`, label "Pointage RH".
- Permissions : `pointage.pointer`, `pointage.consulter_historique`,
  `pointage.consulter_tous`, `pointage.pointage_exceptionnel`,
  `pointage.corriger_pointage`, `pointage.gerer_horaires`,
  `pointage.voir_dashboard_rh`, `pointage.voir_reporting`.
- Répartition : **Collaborateur** → `pointer` + `consulter_historique` ;
  **RH** (nouveau rôle) → les 8 permissions du module ; **DG** → lecture
  seule (`consulter_tous`, `voir_dashboard_rh`, `voir_reporting`), cohérent
  avec "consultation selon les droits accordés" ; **Admin** → aucune
  (accès admin via `isAdmin()`, pas via permissions — voir
  [Administration](#administration-console-admin)).
- Compte de test : `rh@simassurances.test` / `password123`.

### Tester le parcours QR

1. Démarrer l'application avec `npm run dev`. Si le port 3000 est déjà pris,
  utiliser le port indiqué par Next.js.
2. Depuis un navigateur, ouvrir `/pointage/qr`.
3. Vérifier qu'un utilisateur non connecté est envoyé vers `/login` avec un
  `callbackUrl` contenant `/pointage?source=QR_CODE`.
4. Se connecter avec `collaborateur@simassurances.test` / `password123`.
5. Vérifier le retour automatique vers `/pointage?source=QR_CODE`, l'affichage
  du bandeau « Pointage par QR code », puis valider une arrivée ou un départ.
6. Vérifier que l'écran affiche immédiatement la date et l'heure retournées
  par le serveur. En cas d'arrivée après l'horaire de référence, le motif
  de retard doit être obligatoire et les minutes doivent être calculées.

Pour tester avec un téléphone connecté au même réseau que le PC, le QR code
doit contenir l'URL réseau du PC, par exemple
`http://192.168.1.22:3000/pointage/qr`, et non `localhost`. Le port réel est
celui affiché par `npm run dev`.

En développement, l'adresse réseau du PC est aussi déclarée dans
`next.config.ts` via `allowedDevOrigins` pour autoriser les ressources HMR
(`/_next/hmr`) chargées depuis le téléphone. Si l'adresse IP du PC change,
mettre à jour cette liste et redémarrer Next.js.

Après un pointage réussi, contrôler dans PostgreSQL qu'il existe :

- une ligne `Pointage` avec `source = QR_CODE` et l'heure serveur ;
- une ligne `HistoriqueEntry` avec `entity = Pointage`, le même `entityId`
  et `action = CREATE` ;
- une ligne `HistoriqueEntry` avec `entity = PointageQR` et `action = SCAN`
  pour un scan effectué avec une session existante.

La création du pointage et sa ligne d'historique sont réalisées dans une
transaction Prisma : elles réussissent ou échouent ensemble. Un scan anonyme
est redirigé vers la connexion et ne peut pas être attribué à un utilisateur ;
le pointage réalisé après connexion, lui, est toujours journalisé.

### Contrôle du terminal et du réseau (Ticket 3)

Le serveur détecte le terminal via l'en-tête `User-Agent` avant d'afficher les
paramètres de pointage : téléphone (`TELEPHONE`) ou ordinateur
(`ORDINATEUR`). Un ordinateur n'affiche pas le formulaire et ne peut pas
pointer si son adresse IP n'est pas présente dans `ALLOWED_OFFICE_IPS`, une
liste séparée par des virgules. Le même contrôle est répété dans la Server
Action : une valeur `source` modifiée dans le navigateur ne permet donc pas de
contourner la restriction. Un refus réseau authentifié est historisé avec
`entity = PointageAccess` et `action = ACCESS_DENIED`.

Pour tester ce ticket en local, définir par exemple
`ALLOWED_OFFICE_IPS=127.0.0.1` dans `.env`, redémarrer Next.js, puis ouvrir
`/pointage` sur le PC. Pour tester un refus, retirer l'adresse de la liste.
Pour un téléphone, utiliser l'URL réseau du PC et le port de Next.js ; le
téléphone est détecté séparément et n'est pas soumis à la restriction IP du
poste ordinateur.

Les liens RH tels que `/pointage/rh` peuvent encore retourner `404` tant que
les tickets d'espace RH (à partir du ticket 8) ne sont pas implémentés. Le
parcours collaborateur à tester reste `/pointage` ou `/pointage/qr`.

## Authentification

- Provider **Credentials** uniquement pour l'instant (email + mot de passe
  vérifié avec `bcrypt.compare` contre `User.passwordHash`).
- Stratégie de session **JWT** (pas de session base de données / pas
  d'`@auth/prisma-adapter`) : Auth.js ne supporte pas les sessions
  persistées en base avec le Credentials provider.
- Le contrat applicatif à utiliser dans le reste du code est
  `getSession()` / `hasPermission()` / `isAdmin()` / `getAccessibleModules()`
  exportés par [src/lib/auth.ts](src/lib/auth.ts) — voir les commentaires du
  fichier pour le détail d'usage. Ne pas appeler `auth()` directement en
  dehors de ce fichier pour la vérification de permissions.

## Administration (console `/admin`)

- **`isAdmin(session)`** (dans [src/lib/auth.ts](src/lib/auth.ts)) donne
  l'accès à la console d'administration. C'est un **bypass sur
  `role.name === "Admin"`**, pas une permission stockée dans
  `RolePermission` — choix délibéré (deux raisons, détaillées en
  commentaire dans le fichier) :
  1. Le rôle Admin garde un accès total à `/admin` même si personne n'a (ou
     plus) pensé à lui attribuer les bonnes permissions — impossible de se
     retrouver bloqué hors de la console.
  2. La console d'admin est une fonctionnalité du **Socle**, orthogonale au
     système de permissions par module (`treso.*`...) qui sert aux modules
     métier. Être Admin ne donne **pas** automatiquement les permissions
     métier des autres modules — `hasPermission()` reste la seule source de
     vérité pour celles-ci (séparation des rôles). Dans le seed, le rôle
     Admin n'a donc volontairement aucune ligne `RolePermission`.
  - Toujours vérifier `isAdmin(session)` **dans la Server Action elle-même**,
    jamais seulement via le layout ou le masquage de l'UI.
- **`getAccessibleModules(session)`** retourne les modules actifs
  (`Module.isActive`) auxquels le rôle a accès (au moins une permission
  rattachée au module). Générique : aucune modification de code nécessaire
  à l'ajout d'un futur module. Utilisée par le dashboard
  ([src/app/(dashboard)/page.tsx](<src/app/(dashboard)/page.tsx>)) pour
  n'afficher que les cartes de modules pertinentes, et indirectement par
  `/admin/modules` (désactiver un module le fait disparaître de tous les
  dashboards, immédiatement — pas de cache à invalider manuellement grâce à
  `revalidatePath`).
  - **Cas particulier Admin** : comme le rôle Admin n'a volontairement
    aucune `RolePermission` (voir ci-dessus), un filtrage par permissions
    ne lui montrerait jamais aucun module — corrigé en faisant retourner à
    `getAccessibleModules()` **tous** les modules actifs dès que
    `isAdmin(session)` est vrai, sans passer par le filtre de permissions.
    L'Admin garde ainsi une vue d'ensemble de tous les modules métier sur
    son dashboard, sans que cela lui donne les permissions d'action de ces
    modules (toujours régies par `hasPermission()`).
- Structure de la console (toutes les routes sous
  [src/app/(dashboard)/admin/](<src/app/(dashboard)/admin>), donc URL
  `/admin`, `/admin/users`, etc.) :
  - `admin/users` — création d'utilisateur (Server Action + zod + bcrypt),
    activation/désactivation (**jamais de suppression** d'utilisateur).
  - `admin/roles` — matrice de permissions par rôle, groupées par module ;
    chaque case à cocher appelle directement une Server Action (pas de
    bouton "Enregistrer" global — persistance immédiate par case).
  - `admin/modules` — activation/désactivation par module.
  - `admin/categories` — gestion des `Categorie`/`Objet` de Trésorerie
    (Ticket A.1, voir détail ci-dessous).
  - Chaque mutation (création utilisateur, activation/désactivation,
    changement de permission) est historisée dans `HistoriqueEntry`.
- **Piège Server/Client à connaître** : `DataTable` (voir
  [Design system](#design-system--composants-ui)) est un Client Component.
  Ses `columns` contiennent des fonctions (`accessor`/`render`) : elles ne
  peuvent **pas** être construites dans une page Server Component puis
  passées en props (React/Next refuse de sérialiser des fonctions à travers
  la frontière Server → Client, sauf Server Actions). Solution utilisée
  partout dans `admin/` : un petit wrapper Client Component (ex:
  `UsersTable.tsx`, `ModulesTable.tsx`) qui reçoit uniquement les données
  (sérialisables) en props et construit lui-même les `columns`. Reproduire
  ce pattern pour toute nouvelle page Trésorerie utilisant `DataTable`
  depuis un Server Component.

### `admin/categories` — Gestion des Catégories/Objets (Ticket A.1)

**Statut : terminé.** Résout la dette technique identifiée au Ticket 2 : le
cahier des charges exige une liste de catégories paramétrable, mais aucune
interface n'existait (seulement le seed).

**Soft-delete `isActive`** — `Categorie` et `Objet` gagnent un champ
`isActive Boolean @default(true)` (migration `add_isactive_categorie_objet`),
même principe que `Module.isActive` : **jamais de suppression définitive**,
uniquement une désactivation. Nécessaire car `Categorie`/`Objet` sont
potentiellement référencés par des `Demande` existantes (`categorieId`,
`objetId`) — une vraie suppression casserait l'intégrité de l'historique.

**Écran** (`admin/categories/page.tsx`) : liste des catégories avec leurs
objets imbriqués (liste indentée), inactives visuellement distinguées
(opacité réduite + `Badge` neutre). Formulaire de création de catégorie en
haut, formulaire d'ajout d'objet sous chaque catégorie
(`ObjetCreateForm.tsx`, `categorieId` en champ caché), et un bouton
Activer/Désactiver par ligne (`ActiveToggleButton.tsx`) — généralisation de
`ModuleActiveToggle.tsx` (admin/modules) avec l'action de toggle en prop,
partagée entre les lignes Catégorie et Objet plutôt que deux composants
quasi identiques.

**Répercussion dans le reste de l'app** — `treso/finance/demandes/[id]/page.tsx`
(Ticket 2) et `treso/finance/reporting/page.tsx` (Ticket 10) filtrent
désormais leurs requêtes `categorie.findMany`/`objet.findMany` par
`isActive: true` : une catégorie désactivée n'est plus proposable pour une
nouvelle catégorisation ni un nouveau filtre de reporting.

**Piège trouvé et corrigé en vérification manuelle** — une demande restée
`EN_ATTENTE` et déjà catégorisée avec une catégorie désactivée entre-temps
faisait planter silencieusement `CategorisationForm` : sa catégorie n'étant
plus dans la liste (filtrée sur `isActive: true`), le `<select>` non
contrôlé retombait sur sa **première option de la liste** (comportement
natif du navigateur pour une `defaultValue` sans option correspondante),
sans que l'état React `categorieId` ne s'en aperçoive. Réenregistrer le
formulaire sans rien changer aurait alors **écrasé silencieusement** la
vraie catégorie par cette fausse valeur affichée. Corrigé en réinjectant
dans la liste d'options la catégorie/l'objet déjà assignés à *cette*
demande précise, même désactivés (libellé suffixé « (inactive) ») —
jamais les autres catégories/objets désactivés, qui restent indisponibles
pour toute nouvelle sélection. Vérifié explicitement : catégorie de test
désactivée après catégorisation d'une demande restée `EN_ATTENTE` → le
`<select>` affiche maintenant correctement « (inactive) » comme valeur
sélectionnée, et une resoumission du formulaire sans modification conserve
la bonne catégorie.

**Navigation** — "Catégories" (`folder-tree`) ajouté dans la section
"Administration" de la sidebar, à côté de Utilisateurs/Rôles/Modules.

**Piège de navigation trouvé et corrigé au passage** — le même problème de
préfixe déjà rencontré au Ticket 8 (`/treso/finance` préfixe de
`/treso/finance/demandes`) existait aussi dans `ADMIN_GROUP` : "Vue
d'ensemble" (`/admin`) est un préfixe strict de `/admin/users`,
`/admin/modules`, etc., donc les deux s'allumaient simultanément sur toute
sous-route admin. Corrigé en ajoutant `exact: true` sur l'item "Vue
d'ensemble", même mécanisme déjà en place dans `Sidebar.tsx`.

**Vérifié explicitement** : catégorie de test créée avec deux objets,
immédiatement disponible dans le formulaire de catégorisation Finance ;
désactivée ensuite → absente du Select de catégorisation pour une nouvelle
demande et des filtres de reporting, mais la demande qui la référençait
déjà continue de l'afficher correctement (catégorie + objet), y compris
dans le cas `EN_ATTENTE` encore modifiable (piège ci-dessus). Le compte
Finance (non-Admin) n'a accès ni au lien ni à `/admin/categories`
(redirection + toast). Toutes les données de test supprimées.

## Où trouver le schéma de données

Le schéma complet (modèles, enums, relations) est dans
[prisma/schema.prisma](prisma/schema.prisma).

## Lancer le projet

```bash
npm install                # installer les dépendances
npx prisma migrate dev     # appliquer les migrations sur la base locale
npx prisma db seed         # peupler la base (rôles, permissions, 5 comptes de test, catégories/objets)
npm run dev                # démarrer le serveur de développement
```

Prérequis : un fichier `.env` avec `DATABASE_URL` (PostgreSQL) et
`AUTH_SECRET` (secret de signature des JWT Auth.js, généré avec
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).

Comptes de test (mot de passe `password123` pour tous) :
`collaborateur@simassurances.test`, `finance@simassurances.test`,
`dg@simassurances.test`, `admin@simassurances.test`, `rh@simassurances.test`.

## Déploiement Docker

Le projet est entièrement conteneurisé (application Next.js + PostgreSQL) :
démarrage reproductible sur n'importe quelle machine avec Docker installé,
sans dépendance à l'environnement local. **Guide complet, étape par
étape :** [DEPLOIEMENT.md](DEPLOIEMENT.md).

Fichiers concernés : `Dockerfile` (build multi-étapes `deps` → `builder` →
`prod-deps` → `runner`), `docker-compose.yml` (services `db` et `app`),
`docker-entrypoint.sh` (migrations au démarrage), `.dockerignore`,
`.env.example`.

Choix techniques principaux (détaillés en commentaires dans `Dockerfile`) :

- **Image de base Debian** (`node:20-bookworm-slim`), pas Alpine, par
  précaution vis-à-vis des binaires natifs Prisma — même si ce projet,
  avec le driver adapter `@prisma/adapter-pg`, n'utilise aucun moteur de
  requête binaire au runtime (`src/generated/prisma` ne contient que du
  TypeScript). Seul le "schema engine" (CLI `prisma generate`/`migrate
  deploy`) reste un binaire natif, téléchargé automatiquement pour la
  plateforme Linux du conteneur — **`binaryTargets` n'a donc pas été
  ajouté** au bloc `generator` de `schema.prisma`, volontairement.
- **Migrations automatiques, seed manuel jamais automatisé** :
  `docker-entrypoint.sh` lance `prisma migrate deploy` (pas `migrate dev`)
  avant `node server.js` à chaque démarrage du conteneur `app` ; le seed
  (`prisma/seed.ts`, qui fait des `deleteMany`) ne tourne jamais tout seul
  — commande dédiée documentée dans `DEPLOIEMENT.md`
  (`docker compose exec app npx prisma db seed`), à lancer une seule fois.
- **Volume `uploads`** déjà prêt sur `/app/uploads` dans le conteneur
  `app`, pour la future fonctionnalité de pièce jointe (`PieceJointe`,
  non implémentée) — aucun changement de configuration Docker nécessaire
  le jour où elle sera développée.
- `prisma`, `tsx` et `dotenv` sont dans `dependencies` (pas
  `devDependencies`) : nécessaires au runtime du conteneur (migrations,
  seed manuel), pas seulement au build.

## Socle Portail : statut

Le Socle Portail est **terminé** : authentification (Auth.js v5,
`getSession()`/`hasPermission()`), design system et composants UI
réutilisables, identité visuelle SIM Assurances, dashboard personnalisé par
droits, et console d'administration complète (`isAdmin()`,
`getAccessibleModules()`, `/admin/users`, `/admin/roles`, `/admin/modules`).

Le **Module Trésorerie** est désormais **entièrement terminé** (Tickets 1 à
10 — backlog initial complet) : il couvre l'intégralité du cycle métier
des sections 2 à 15 du cahier des charges — création de la demande
(Ticket 1) → catégorisation par Finance (Ticket 2) → validation/rejet
(Ticket 3) → règlement Caisse/Banque avec grand livre `JournalCaisse`
(Ticket 4) → déclaration d'un retour de caisse par le Collaborateur
(Ticket 5) → réception du retour par Finance, seul moment où la caisse est
réellement créditée (Ticket 6) → régularisation et clôture
totale/partielle, qui referme définitivement le dossier (Ticket 7) →
dashboard Finance donnant une vue d'ensemble recalculée en temps réel de
tout ce cycle (Ticket 8) → reçu PDF téléchargeable par règlement (Ticket 9)
→ reporting agrégé, suivi budgétaire et export Excel multi-feuilles
(Ticket 10). Voir
[Règles métier impératives](#règles-métier-impératives--module-trésorerie)
pour les invariants transversaux (verrouillages définitifs, immutabilité du
grand livre, historisation systématique) qui traversent ces dix tickets.

Le développement de ce module a suivi les conventions et patterns du Socle
sans jamais le modifier : routes sous `src/app/(dashboard)/treso/`,
composants métier sous `src/components/tresorerie/`, composants `ui/`,
`ActionState` + `useActionFeedback` pour les formulaires,
`getSession()`/`hasPermission()` pour les permissions,
`getAccessibleModules()` pour la carte "Gestion des demandes et
trésorerie" sur le dashboard — un patron directement réutilisable pour tout
futur module métier du portail (à commencer par Pointage RH ci-dessous).

Les **fondations de données du Module Pointage RH** et les tickets 1 et 2 sont
en place (voir
[Module Pointage RH : fondations de données et parcours QR](#module-pointage-rh--fondations-de-données-et-parcours-qr))
— rôle RH, module `pointage`, ses 8 permissions, modèles `Pointage` /
`CorrectionPointage` / `Absence` / `ParametrageHoraire`, compte de test,
pointage collaborateur et destination QR. Les prochains écrans à développer
concernent l'historique collaborateur et les fonctions RH.

## Polish visuel global (post-Refonte V1)

**Statut : terminé.** Une fois le backlog métier (Refonte V1, Tickets 1-10
+ Phases A-H) entièrement posé et vérifié, passage de polish visuel sur
**toute l'application** — aucune logique métier, Server Action ni requête
de données modifiée : uniquement CSS/Tailwind, structure de mise en page,
transitions et micro-interactions. Instructions de design suivies :
principes de design engineering (courbes d'accélération, budgets de durée,
justification de chaque animation par sa fréquence d'usage) et check-list
UX/accessibilité (contraste, zones tactiles, retour visuel des formulaires).

**Fondation transversale** — trois nouvelles courbes d'accélération dans
`globals.css` (`--ease-out-strong`, `--ease-in-out-strong`, `--ease-drawer`,
exposées comme utilitaires Tailwind natifs `ease-out-strong` etc. via
`@theme inline`) : les easings CSS natifs sont trop "mous" pour des
micro-interactions volontaires. **Seule référence à utiliser pour toute
nouvelle transition** — ne pas en réinventer d'autres. Deux classes
d'entrée réutilisables : `.animate-fade-in-up` (fondu + léger décalage
vertical, 250ms, pour les panneaux qui se révèlent : formulaire qui
s'ouvre, décision qui se confirme) et `.animate-fade-in` (fondu pur, pour
les fonds d'estompage). Les deux sont neutralisées sous
`prefers-reduced-motion` (comme `.stat-card-enter` du Ticket 8). Toute
transition basée sur `transform` (hover, press, chevrons) est systématiquement
gardée par `motion-safe:` — jamais de mouvement non gardé.

- **Login** — carte recentrée avec décor discret (dégradé radial dérivé de
  `--color-primary` via `color-mix`, aucune nouvelle couleur), entrée en
  fondu de la carte, bannière d'erreur avec icône. Bouton de connexion
  câblé sur un état de chargement réel (`LoginSubmitButton.tsx`,
  `useFormStatus` — purement visuel, aucune logique d'auth dupliquée).
  Couleurs brutes (`slate-*`, `bg-white`) remplacées par les tokens du
  design system.
- **AppShell (Sidebar + Topbar)** — mêmes tokens partout (fin des couleurs
  `slate-*` restantes), retour de pression (`active:scale`) sur tous les
  boutons icône (bascule réduire/déployer, déconnexion, menu mobile,
  notifications), tiroir mobile sur la courbe `--ease-drawer` (300ms) avec
  fondu du fond d'estompage, chevrons d'accordéon et de bascule sur
  `ease-out-strong`. Le tiroir mobile est explicitement neutralisé sous
  `prefers-reduced-motion` (`motion-reduce:transition-none`) — seule sa
  position change, plus de transition animée.
- **Composants génériques `ui/`** — `Button` gagne un retour de pression
  (`scale(0.97)` sur `:active`, gardé par `motion-safe:`) et remplace son
  `transition-colors` implicite par une liste de propriétés explicite ;
  `Input`/`Textarea`/`Select` gagnent une transition de bordure au survol ;
  `Card` perd ses couleurs brutes ; `DataTable` gagne une transition sur le
  survol de ligne (jusque-là instantané) et un nouveau composant
  **`EmptyState`** (icône dans une pastille neutre + message) remplace le
  texte gris centré pour toute liste vide — DataTable expose son
  `emptyMessage` existant à travers ce composant, donc **toutes** les
  listes du portail en profitent sans modification individuelle.
  `StatCard` (Ticket 8) est corrigé pour respecter les standards : son
  `transition-all` est remplacé par une liste de propriétés explicite, et
  l'icône flèche du lien "Voir le détail" (mouvement non gardé jusqu'ici)
  est désormais sous `motion-safe:`.
- **Formulaires d'action** — les boutons de soumission utilisaient déjà
  systématiquement `loading={isPending}` (convention déjà en place depuis
  le Ticket 1) : aucun changement nécessaire là. Le vrai manque identifié
  était l'apparition **instantanée** des panneaux révélés par un clic
  (Valider/Rejeter, Clôturer, Modifier/Annuler un règlement, Validation
  complémentaire, formulaire de retour de caisse, champs conditionnels de
  la dépense directe) : `.animate-fade-in-up` appliquée uniformément à ces
  panneaux et aux lignes de dépense ajoutées dynamiquement.
- **Listes et tableaux** — héritent automatiquement du polish de
  `DataTable` (survol de ligne, `EmptyState`) : aucune modification
  nécessaire sur les tableaux spécifiques (`MesDemandesTable`,
  `ADecaisserTable`, `RetoursEnAttenteTable`, etc.), qui ne font que lui
  passer des colonnes/données.
- **Toasts (sonner)** — le `<Toaster>` utilisait `richColors` (palette
  générique rouge/vert/bleu de sonner, incohérente avec la charte).
  Remplacé par `toastOptions.classNames` mappé sur les tokens sémantiques
  du projet (`success`/`danger`/`info`/`warning`) — mêmes teintes que les
  `Badge` de statut ailleurs dans l'app.
- **États vides** — au-delà de `DataTable`, le tableau de bord général
  (`(dashboard)/page.tsx`) gagne le même traitement `EmptyState` sur ses
  trois zones vides ("Aucun module", "Aucune notification", "Aucune action
  en attente"), plus une entrée en fondu échelonnée (`.stat-card-enter`,
  déjà utilisée sur le dashboard Finance du Ticket 8) sur ses 4 indicateurs
  et un survol/press sur les cartes de module.

**Point délibérément non touché** — la transition de largeur de la Sidebar
au repli/déploiement (`lg:transition-[width]`, préexistante) anime une
propriété hors GPU (`width`), techniquement déconseillé. Corriger cela
proprement demanderait de restructurer le mécanisme de repli (ex: mesure
JS + `transform: scaleX` ou grid-template-columns animé), un chantier plus
invasif que ce qu'un passage de polish justifie — l'impact réel reste
négligeable (transition rare, déclenchée par un clic explicite, jamais en
boucle ni au chargement de page). Signalé ici pour référence future plutôt
que corrigé silencieusement.

**Vérifié explicitement** : `tsc --noEmit` et `eslint` sans erreur sur tout
`src/`. Parcours Playwright complet (login → dashboard admin → dashboard
Finance → reporting → création d'une demande → détail Collaborateur →
détail Finance avec validation/règlement/régularisation/clôture) sans
erreur console. Scénario de bout en bout vérifié : demande créée,
validée totalement, réglée en Caisse, règlement confirmé — chaque section
(Règlements, Régularisation, Clôture, Historique) s'affiche correctement
avec les nouvelles transitions. Rendu mobile (390px) vérifié sur le login,
le dashboard, le tiroir de navigation ouvert, et le formulaire de nouvelle
demande. Toutes les données de test créées pendant la vérification
supprimées après coup.

## Audit et corrections responsive mobile (post-polish visuel)

**Statut : terminé.** Audit systématique à 375px (mobile), 768px (tablette)
et 1280px (desktop) de tout le Socle (login, dashboard général, `admin/*`)
et tout le Module Trésorerie (`treso/*`, y compris les 8 listes Finance de
la Phase G/H et le reporting). **Hors périmètre, non touché** : le Module
Pointage RH (développé séparément) — voir la note dédiée en fin de section.

### Méthode

Audit fait **avant** toute correction : sweep Playwright automatisé (21
routes × 3 largeurs, détection de dépassement horizontal au niveau du
document via `scrollWidth`/`clientWidth`) puis revue visuelle systématique
de chaque capture à 375px. Le sweep automatisé n'a révélé aucun
dépassement au niveau du document — attendu, puisque `DataTable` masquait
déjà son propre débordement interne via `overflow-x-auto` (le symptôme
n'est pas un scroll de page, mais un tableau illisible/tronqué à
l'intérieur de son cadre) : seule la revue visuelle l'a fait apparaître,
confirmant que la métrique automatisée seule est insuffisante pour ce
genre de régression.

### Constat principal : `DataTable` (point de rupture confirmé)

À 375px, chaque écran utilisant `DataTable` (10 wrappers : `UsersTable`,
`ModulesTable`, `MesDemandesTable`, `ADecaisserTable`, `ARegulariserTable`,
`DemandesACategoriserTable`, `DepensesNonJustifieesTable`,
`FondsARegulariserTable`, `ReglementsPartielsTable`,
`RetoursEnAttenteTable`) ne laissait voir que les 2-3 premières colonnes ;
le reste (Montant, Statut, et surtout la colonne **Actions** — le bouton
"Voir"/"Traiter" qui est le seul point d'entrée de l'écran) était poussé
hors écran **sans aucun indice de défilement**. Bug induit constaté au
passage : l'état vide (`EmptyState`, rendu dans un `<td colSpan>`) héritait
de la largeur totale (large) de la table débordante et s'affichait
décentré/tronqué plutôt que proprement centré.

**Stratégie retenue : Option B, cartes empilées** (`src/components/ui/DataTable.tsx`)
plutôt que défilement horizontal avec indice visuel. Choisie parce que ces
10 écrans sont tous des *listes d'éléments cliquables* (chaque ligne mène à
un détail via son bouton d'action) — le mode carte, où chaque ligne devient
un bloc autonome avec toutes ses informations et son bouton d'action
directement visibles, sert mieux ce usage qu'un tableau qu'il faudrait
faire défiler horizontalement avant de trouver le bouton. Implémentation :

- En dessous de `md`, le tableau HTML est remplacé par une liste de cartes
  (`space-y-3`) : **première colonne** rendue en titre (`font-medium`),
  colonnes suivantes en paires libellé/valeur (`<dl>`, `flex justify-between`),
  et toute colonne dont l'en-tête correspond à `/^actions?$/i` détachée en
  pied de carte sous un séparateur (`border-t`) — jamais mélangée aux
  paires libellé/valeur, pour que le(s) bouton(s) restent immédiatement
  identifiables. Fonctionne sans configuration supplémentaire : les 10
  wrappers existants ont tous, par construction, une première colonne
  significative (référence/nom) et une dernière colonne "Actions" — aucun
  n'a eu besoin d'être modifié pour bénéficier du nouveau rendu.
- **Tri par colonne préservé** : les en-têtes cliquables disparaissant en
  mode carte, un sélecteur "Trier par" (natif `<select>`, visible
  uniquement sous `md`) liste les colonnes `sortable`, pilotant le même
  état de tri (`sort`/`setSort`) que le clic d'en-tête en mode tableau — un
  seul état de tri, deux façons de le déclencher selon la largeur d'écran.
- À partir de `md`, comportement strictement inchangé (tableau HTML avec
  `overflow-x-auto`, tri par clic d'en-tête). Le bug d'`EmptyState`
  décentré est résolu au passage : l'état vide sort désormais du tableau
  (rendu directement dans le conteneur, plus jamais dans un `<td>`), quelle
  que soit la largeur d'écran.

**Exception délibérée, hors du composant `DataTable`** : les deux tableaux
analytiques de `treso/finance/reporting/page.tsx` ("Demandes par
catégorie/objet" — 10 colonnes numériques + ligne de total — et "Suivi
budgétaire") sont écrits en HTML brut, pas via le composant `DataTable`, et
**ne sont pas passés en mode carte**. Choix assumé : une carte par ligne
n'a pas de sens pour une grille de reporting dense avec une ligne "Total
général" à comparer visuellement colonne par colonne — l'usage attendu
reste la lecture en tableau, y compris sur mobile. **Stratégie A** retenue
ici à la place : indice textuel explicite "Faites glisser pour voir plus de
colonnes →" (visible uniquement sous `md`, au-dessus du tableau), le
`overflow-x-auto` existant assurant le défilement. Les autres écrans
Finance n'ont pas ce problème : ils utilisent tous le composant `DataTable`
partagé, jamais un tableau réécrit à la main.

### Autres corrections (Tâches 3 à 6)

Le reste de l'audit (formulaires multi-colonnes, grilles de `StatCard`,
panneaux d'action déclenchés au clic, zones à plusieurs boutons) était
**déjà conforme avant cet audit** — vérifié visuellement à 375px, aucune
correction de code nécessaire au-delà de `DataTable` et du reporting
ci-dessus :

- Tous les formulaires (`ReglementForm`, `RetourCaisseForm` — y compris ses
  lignes de dépense dynamiques (Phase D), dépense directe, filtres de
  reporting, formulaires admin) utilisent déjà `grid-cols-1 sm:grid-cols-2`
  ou une simple pile verticale : aucun formulaire ne force plusieurs
  colonnes sous `sm`.
- Les grilles de `StatCard` (dashboard général, dashboard Finance à 6
  indicateurs de la Phase G) sont déjà `grid-cols-1 sm:grid-cols-2 lg:...` :
  reflow correct à toutes les largeurs testées.
- Les panneaux d'action révélés au clic (`ValidationActions`,
  `ClotureActions`, formulaire de règlement, validation complémentaire,
  formulaire de retour de caisse) restent entièrement visibles et lisibles
  à 375px sans zoom ni débordement.
- Les zones à plusieurs boutons (reçu + bon de caisse + Annuler sur
  `ReglementRow`/`ReglementsRecusSection` ; Valider/Rejeter ; Clôturer
  totalement/partiellement) utilisaient déjà `flex flex-wrap gap-3` :
  empilement propre sur mobile, déjà vérifié à l'écran avant cet audit.
- `admin/categories` (`CategoriesList.tsx`) : le motif visuellement
  inconsistant repéré sur une première capture (bouton "Désactiver" tantôt
  sur sa propre ligne, tantôt accolé au badge) a été revérifié
  spécifiquement — le code utilise bien `flex flex-wrap items-center
  justify-between gap-3` de façon identique sur toutes les lignes ; l'
  inconsistance apparente n'était pas reproductible sur une capture
  fraîche et est attribuée à un artefact de mise à l'échelle du
  screenshot pleine page, pas à un défaut de code. Aucune modification.

### Vérifié explicitement

`npx tsc --noEmit` et `npx eslint .` sans erreur sur `src/`. Sweep
automatisé Playwright (21 routes × 375/768/1280px) sans dépassement de
document avant ET après les corrections. Parcours complet à 375px piloté
par un vrai navigateur (Playwright, non ajouté au projet) : connexion,
ouverture du tiroir de navigation mobile, création d'une demande,
consultation de la liste (nouveau mode carte de `DataTable`), ouverture du
détail avec ses sections (Règlements, Retours, Historique), validation
totale par Finance, ajout et confirmation d'un règlement Caisse — **zéro
erreur console** sur l'ensemble du parcours. Bascule à 768px vérifiée sans
régression sur le même détail de demande (retour au mode tableau/grille
classique). Toutes les données de test créées pendant cet audit
supprimées (3 demandes et leurs règlements/écritures de caisse/historique
associés) ; serveur `next dev` arrêté après vérification.

### Signalé pour le Module Pointage RH (hors périmètre, non corrigé)

Aucune route de ce module n'a d'écran développé à ce jour (voir
[Module Pointage RH : fondations de données](#module-pointage-rh--fondations-de-données)) :
rien n'a donc pu être audité ni corrigé ici. À traiter par le binôme en
charge de ce module au moment où ses écrans seront construits — en
particulier `DataTable` (désormais réutilisable telle quelle en mode carte
mobile) sera probablement le composant de liste à privilégier pour rester
cohérent avec le reste du portail.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
