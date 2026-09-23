# sim-portail

> Historique détaillé (phases, tickets, audits, décisions superseded) : [CLAUDE_HISTORIQUE.md](CLAUDE_HISTORIQUE.md).


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
(voir [Module Pointage RH : fondations de données et parcours QR](#module-pointage-rh--fondations-de-données-et-parcours-qr)).

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


---

## Module Trésorerie — état actuel (Refonte V1 terminée)

Le Module Trésorerie a été entièrement réécrit selon le cahier des charges
« CAHIER DES CHARGES — V1 » (Phases A à H, toutes terminées) puis complété
par de nombreuses corrections/extensions ultérieures. Ce qui suit est
l'état **actuel** des règles ; l'historique complet de chaque phase, ticket
et audit est dans [CLAUDE_HISTORIQUE.md](CLAUDE_HISTORIQUE.md).

### Statut d'une demande (`StatutDemande`)

11 valeurs : `BROUILLON`, `EN_ATTENTE_VALIDATION`, `VALIDEE`,
`PARTIELLEMENT_VALIDEE`, `VALIDEE_NON_REGLEE`, `PARTIELLEMENT_REGLEE`,
`REGLEE`, `REJETEE`, `EN_ATTENTE_REGULARISATION`, `REGULARISEE`,
`CLOTUREE` (une seule valeur de clôture ; la distinction totale/partielle
vit uniquement dans `Demande.motifCloture`, jamais dans le statut).

**`calculerStatutDemande(demandeId)`** (`backend/src/tresorerie.ts`) est la
**seule** fonction qui fixe ce statut (aucune Server Action ne l'écrit à la
main) :

| Condition | Statut déduit |
|---|---|
| Statut actuel `REJETEE` ou `CLOTUREE` | inchangé (états terminaux) |
| `montantValide` nul ou 0 | `EN_ATTENTE_VALIDATION` |
| `0 < montantValide < montant demandé` | `PARTIELLEMENT_VALIDEE` |
| `montantValide === montant`, `getTotalRegle() === 0` | `VALIDEE_NON_REGLEE` |
| `montantValide === montant`, `0 < réglé < montantValide` | `PARTIELLEMENT_REGLEE` |
| `montantValide === montant`, `réglé >= montantValide` | `REGLEE` |

`VALIDEE` n'est **plus jamais produit** par cette fonction (une validation
totale transite directement vers `VALIDEE_NON_REGLEE`) ; il reste dans
l'enum uniquement pour compatibilité historique. Comparaisons de montants
en centimes entiers (`Math.round(montant * 100)`), jamais en égalité
flottante directe.

### Validation

- **`validerTotalementAction(demandeId)`** — réservée à
  `EN_ATTENTE_VALIDATION`, `montantValide` = montant demandé en une fois.
- **`validerPartiellementAction(demandeId, montant)`** — réservée à
  `EN_ATTENTE_VALIDATION` ; un montant > montant demandé est **refusé**
  côté serveur (jamais plafonné silencieusement).
- **`validerComplementaireAction(demandeId, montant)`** — réservée à
  `PARTIELLEMENT_VALIDEE` ; le cumul ne peut jamais dépasser le montant
  demandé (refusé sinon). Refusée si `reliquatRejete` est déjà `true`.
- **`rejeterDemandeAction`** — réservée à `EN_ATTENTE_VALIDATION` (motif
  obligatoire, min 3 caractères). Une demande déjà `PARTIELLEMENT_VALIDEE`
  ne peut plus être rejetée dans son ensemble.
- **`rejeterReliquatAction(demandeId, motif)`** — réservée à
  `PARTIELLEMENT_VALIDEE`, une seule fois (`Demande.reliquatRejete`,
  `motifRejetReliquat`). N'affecte **jamais** `montantValide` ni `statut` —
  la part déjà validée reste acquise et suit son cours normal. Bloque
  ensuite toute nouvelle `validerComplementaireAction`.
- Permission unique pour valider/rejeter/rejeter le reliquat :
  `treso.valider_demande` (Finance ET DG).
- Aucune fonction de « dévalidation » n'existe nulle part dans le module.

### Règlement

- **`getResteARegler(demandeId)`** = `max(0, montantValide - getTotalRegle())`.
- **`peutEffectuerReglement(demandeId)`** = `montantValide > 0` **ET**
  `getResteARegler() > 0` **ET** statut ni `REJETEE` ni `CLOTUREE`. Un
  règlement est donc possible dès qu'un montant — même partiel — est
  validé, sans attendre la validation complémentaire du reliquat.
- `annulerReglementAction` n'utilise **pas** `peutEffectuerReglement` (sinon
  l'annulation du dernier règlement d'une demande `REGLEE` serait bloquée à
  tort) — seul contrôle : statut ni `CLOTUREE` ni `REJETEE`.
- Un règlement `BANQUE` n'impacte jamais `JournalCaisse` ; un règlement
  `CAISSE` confirmé crée une écriture `SORTIE`, son annulation une écriture
  `ENTREE` compensatoire (le grand livre n'est jamais réécrit ni supprimé).
- Permission : `treso.effectuer_reglement` (Finance uniquement).
- **Distincte de `treso.valider_demande` depuis l'origine** (jamais un
  seul droit couvrant les deux actions) — reconfirmé explicitement par la
  Tâche "Séparer 'valider' de 'régler/décaisser'" : un Responsable Finance
  peut déléguer `effectuer_reglement` seul, via `/delegations`, à un
  collaborateur qui ne pourra alors PAS valider de demande (vérifié en
  pratique, UI et requête réseau directe). Voir aussi "Aide-mémoire —
  permissions actuelles" pour un bug de garde d'accès trouvé et corrigé à
  cette occasion.

### Fonds remis / retour de caisse

- Un `RetourCaisse` contient une liste de `DepenseLigne` (montant, objet,
  date, nature, justification, commentaire obligatoire si
  `justification = SANS_PIECE`), jamais un montant agrégé unique.
- **`montantARetourner` est toujours CALCULÉ** (montant du règlement lié
  moins la somme des `DepenseLigne`), **jamais saisi** — même principe que
  `getSoldeCaisse()` : aucun solde financier n'est modifiable à la main.
- **Déclarer un retour ≠ réceptionner un retour.** Seule la réception
  (Finance, `estReceptionne = true`) crée une écriture `JournalCaisse`
  `ENTREE` et impacte le solde de caisse ; la déclaration seule n'écrit
  jamais dans `JournalCaisse`. **Ré-audité (Tâche "Le retour de caisse
  n'impacte la caisse qu'après validation Finance")** : `grep` exhaustif de
  tous les `journalCaisse.create` du projet confirme que seuls
  `reglementActions.ts` (règlement Caisse confirmé/annulé),
  `finance/retours/retourActions.ts` (`receptionnerRetourAction`) et
  `solde-ouverture/actions.ts` écrivent dans `JournalCaisse` —
  `creerRetourCaisseAction`/`modifierRetourCaisseAction` (déclaration/
  modification côté collaborateur) n'en créent aucune, confirmé aussi par
  un parcours réel (solde de caisse lu avant/après déclaration : inchangé ;
  avant/après réception : mis à jour exactement au moment de la réception).
  Aucun bug trouvé, aucun correctif nécessaire — le comportement était déjà
  conforme.
- Un retour non encore réceptionné peut être **modifié** par son déclarant
  original (`modifierRetourCaisseAction`, diff par id ligne par ligne),
  jamais après réception.
- **`getSoldeARegulariser(reglementId)`** = montant du règlement − dépenses
  déclarées − retours reçus, jamais plafonné à 0 (un résultat négatif
  signale une anomalie réelle).
- Un seul retour par règlement Caisse confirmé.
- **Solde à régulariser (`RegularisationSummary`/`getEcart`) — formule
  vérifiée conforme** à "Fonds remis − Dépenses justifiées − Dépenses non
  justifiées − Retours de caisse validés" : `ecart = decaisse -
  depensesDeclarees - retoursRecus`, où `getDepensesDeclarees` somme déjà
  **toutes** les `DepenseLigne` sans distinction de justification (donc
  justifiées + non justifiées combinées). Mathématiquement identique à
  soustraire les deux parts séparément (distributivité) — confirmé aussi
  bien par relecture du code que par un cas de test réel (Fonds remis
  100 000, dépense justifiée 30 000, dépense non justifiée 20 000, retour
  validé 50 000 → Solde à régulariser = 0). Aucun terme divergent trouvé,
  **aucune modification apportée à la formule elle-même**.

**Retour de caisse optionnel — pas de déclaration forcée de "zéro"** : un
collaborateur qui n'a rien à retourner ni à justifier n'a **aucune action
à effectuer**. La véritable source d'une ancienne impression d'obligation
n'était pas un blocage serveur (le circuit Finance "Retours en attente",
`RETOUR_EN_ATTENTE_WHERE`, a toujours ignoré les règlements sans
`RetourCaisse` — rien ne les y attend) mais le widget collaborateur "Mes
retours de caisse à déclarer", affiché en zone "À traiter" (teinte
`warning`) sur `tableau-de-bord/page.tsx` : reformulé en section séparée
« Retours de caisse (facultatif) », teinte neutre fixe, libellé "aucune
action requise si rien à signaler" — jamais dans la zone actionnable.
Même reformulation sur `demandes/retours-a-declarer/page.tsx` (titre et
description sans framing d'obligation).

- `creerRetourCaisseAction` accepte désormais un tableau de `DepenseLigne`
  **vide** (`lignesSchema` relâché de `.min(1)` à 0+) : un retour "tout
  l'argent, rien dépensé" est une déclaration valide.
- **Formulaire simplifié** (`RetourCaisseForm`, `mode="create"`
  uniquement) — deux champs, date + montant retourné, remplace par défaut
  le formulaire détaillé pour le cas courant. La portion **dépensée**
  (`montantReglement - montantRetourne`) n'est jamais perdue de la
  comptabilité : elle est transmise comme **une seule** `DepenseLigne`
  synthétique (`justification: SANS_PIECE`, commentaire explicite
  "Déclaration simplifiée...") — préserve à la fois le principe
  "`montantARetourner` toujours calculé, jamais saisi" et l'exactitude de
  la formule de Solde à régulariser (rien ne disparaît, une dépense non
  détaillée apparaît honnêtement comme "non justifiée", visible et
  flaggable par Finance). Si le montant retourné égale le montant du
  règlement (rien dépensé), aucune ligne n'est envoyée. Le formulaire
  détaillé (montant/objet/date/nature/justification/commentaire par ligne)
  reste disponible via un lien, pour qui veut réellement justifier
  précisément — le mode `"edit"` reste toujours détaillé (chaque ligne déjà
  en base porte sa propre date).
- **`RetourCaisse.dateRetour`** (`DateTime?`, nouvelle colonne, migration
  `20260913215246_retour_caisse_date_retour`) — renseignée uniquement par
  le formulaire simplifié (date unique du retour) ; `null` pour une
  déclaration détaillée, où chaque `DepenseLigne` porte déjà sa propre
  date. Réinitialisée à `null` par `modifierRetourCaisseAction` (modifier
  implique repasser en mode détaillé). Affichée ("Déclaration simplifiée
  — retour du...") sur `RetourCaisseRow`/`RetoursEnAttenteTable` quand
  non nulle.
- **Tension documentée** : simplifier à "date + montant" tout en
  conservant la déclaration des dépenses justifiées nécessaire à la
  formule de Solde à régulariser semblait a priori contradictoire —
  résolu en synthétisant une `DepenseLigne` unique côté serveur plutôt
  qu'en perdant l'information ; une vraie justification ligne par ligne
  précise reste possible via le formulaire détaillé, jamais retirée.

**Motif Finance sur dépense non justifiée** — `DepenseLigne.motifNonJustifie`
/ `motifNonJustifieParId` / `motifNonJustifieAt` (nouvelles colonnes,
migration `20260914071535_depense_ligne_motif_non_justifie`) : quand
Finance traite un retour et considère une ligne comme non justifiée, un
motif est **obligatoire** (min 3 caractères, refusé sinon côté serveur) et
tracé (`HistoriqueEntry`, action `marquage_non_justifie`).

- **`marquerDepenseNonJustifieeAction(depenseLigneId, motif)`**
  (`treso/finance/retours/retourActions.ts`) — réservée à
  `treso.receptionner_retour` (même permission que la réception
  elle-même). Applicable à une ligne quelle que soit sa justification
  actuelle (y compris déjà `SANS_PIECE` déclarée par le collaborateur —
  Finance peut alors simplement y ajouter son propre motif) : force
  `justification: "SANS_PIECE"` dans tous les cas, pour qu'elle apparaisse
  dans le suivi "Dépenses non justifiées" même si le collaborateur
  l'avait initialement déclarée avec pièce. Verrouillée dès que le retour
  est réceptionné (`estReceptionne`) — même principe que
  `modifierRetourCaisseAction`, aucune correction possible après réception.
- **Distinct de `DepenseLigne.commentaire`** : ce dernier reste la
  justification donnée par le COLLABORATEUR déclarant (déjà obligatoire de
  son côté si `justification = SANS_PIECE` dès la déclaration) —
  `motifNonJustifie` est la propre explication de FINANCE, jamais réécrite
  par le collaborateur, jamais confondue avec `commentaire`.
- UI : `RetoursEnAttenteTable.tsx` (finance/retours), petit formulaire
  inline par ligne ("Marquer non justifiée" → motif + Confirmer, même
  convention que `BudgetAlloueField.tsx`) ; motif déjà enregistré affiché
  en lecture seule ensuite. Colonne "Motif Finance" ajoutée aussi à
  `DepensesNonJustifieesTable.tsx` (écran de suivi dédié).
- Cette action ajoute une **18ᵉ relation directe vers `User`**
  (`motifNonJustifieParId`) — `supprimerUtilisateurAction` (admin/users)
  mise à jour en conséquence (comptage `depenseLigne.count({ where:
  { motifNonJustifieParId: userId } })`), l'ancienne note documentant
  "DepenseLigne n'a aucune relation directe vers User" n'est donc plus
  valable pour ce champ précis (toujours vraie pour le reste de
  `DepenseLigne`, couverte transitivement via `RetourCaisse`/`Demande`).

### Lot de retours Finance (libellés, retours multiples, Voir/Réceptionner, Assistant, réouverture exceptionnelle, pièces jointes)

Six tâches distinctes traitées ensemble, chacune diagnostiquée avant
implémentation.

#### 1. Libellés et validations sur le formulaire de retour

- **"Montant retourné" → "Montant à retourner"** (`RetourCaisseForm.tsx`,
  formulaire simplifié Collaborateur) — **diagnostic** : le libellé exact
  en base n'était pas "Montant" (comme le signalement le supposait) mais
  déjà "Montant retourné" ; le champ visé ne faisant aucun doute (seul
  champ de saisie du montant retourné par le Collaborateur), renommé
  directement vers le libellé cible sans autre clarification nécessaire.
  Le "Montant" du formulaire DÉTAILLÉ (montant d'une LIGNE de dépense,
  concept différent) n'a volontairement pas été touché.
- **"Total déclaré" → "Total dépensé"** — deux occurrences exactes
  trouvées et renommées (`RetourCaisseRow.tsx` côté Collaborateur,
  `RetoursEnAttenteTable.tsx`/l'écran de détail côté Finance) ; "Restant à
  régulariser"/"Montant réglé (Caisse)" et libellés voisins non touchés
  (n'existaient d'ailleurs pas sous ces noms exacts dans ces écrans).
- **`getDateDernierReglementConfirme(demandeId)`** (nouvelle,
  `tresorerie.ts`) — date du règlement CONFIRMÉ le plus récent (tout mode
  confondu) d'une demande, `null` si aucun. Sert de plancher à la date de
  retour du formulaire SIMPLIFIÉ uniquement (`dateRetour`, comparée en
  granularité JOUR — un retour posé le même jour calendaire que la
  confirmation reste valide) : contrainte `min` côté client (`RetourCaisseForm`)
  ET revérifiée côté serveur (`creerRetourCaisseAction`), message précis
  citant la date en cause. **Scope volontairement limité** au formulaire
  simplifié (seul visé par le signalement) — les dates par ligne du
  formulaire détaillé, et les lignes de `declarerRetourAssistantAction`
  (voir plus bas), n'ont pas reçu cette contrainte.

#### 2. Retours multiples autorisés sur une même demande

**Diagnostic** : `creerRetourCaisseAction` bloquait tout nouveau retour
dès qu'`UN` retour existait déjà sur le règlement (`reglement.retours.length
> 0`), reçu ou non — c'est ce contrôle, pas une limite par demande, qui a
été retiré. `getDepensesDeclarees`/`getRetoursRecus`/`getEcart`/
`getSoldesARegulariserParReglements` sommaient déjà correctement sur TOUS
les `RetourCaisse` d'une demande/d'un règlement (`aggregate`/`findMany`
sans limite à un seul) — **aucune de ces fonctions n'a eu besoin d'être
modifiée pour le cumul**, seul le calcul du `montantARetourner` de CHAQUE
retour individuel devait changer pour rester correct en présence de
plusieurs retours.

- **Règle retenue** : jamais deux retours **EN ATTENTE** simultanément sur
  le même règlement (ambiguïté sur lequel réceptionner) — un nouveau
  retour redevient possible dès que le précédent est réceptionné (exactement
  le scénario nommé : "même après qu'un précédent a déjà été
  réceptionné"). Vérifié : un 2ᵉ retour tenté PENDANT que le 1ᵉʳ est encore
  en attente → refusé ; une fois le 1ᵉʳ réceptionné → accepté.
- **`calculerMontantARetournerNet`** (nouvelle, `tresorerie.ts`) —
  généralise l'ancienne formule à un seul retour
  (`max(0, montant du règlement - dépenses déclarées)`, qui reste le
  résultat exact quand aucun autre retour n'existe encore, comportement
  **strictement inchangé** pour le cas courant) : le "restant" disponible
  pour un NOUVEAU retour est le montant du règlement moins ce que les
  AUTRES retours ont déjà consommé — leurs dépenses déclarées (comptées
  qu'ils soient réceptionnés ou non, une dépense déclarée reste déclarée)
  PLUS le montant déjà effectivement RENDU par ceux d'entre eux
  réceptionnés (jamais un retour encore en attente, cet argent n'a pas
  matériellement bougé). Réutilisée par `creerRetourCaisseAction`,
  `modifierRetourCaisseAction` (avec `excludeRetourId`, pour ne jamais
  compter ses propres anciennes lignes comme celles d'un autre retour) et
  `declarerRetourAssistantAction` (voir Tâche 4) — **une seule formule**,
  jamais un second calcul divergent.
- **Conséquence mathématique assumée** : une fois qu'un premier retour a
  intégralement "résolu" le montant du règlement (dépenses + montant
  réceptionné = montant du règlement, par construction), un retour
  SUIVANT sur ce même règlement a par nature un "restant" nul — son
  `montantARetourner` sera donc `0`, et ses dépenses viennent uniquement
  s'AJOUTER au total déjà déclaré (visible sur "Solde à régulariser", qui
  peut alors devenir négatif — signal d'anomalie déjà existant et
  documenté, jamais plafonné). Comportement voulu, pas une limitation :
  un retour complémentaire sert à documenter/corriger la répartition
  justifiée/non justifiée, pas à faire réapparaître de l'argent physique
  qui n'existe plus dans le règlement d'origine.
- **`RetoursCaisseSection`/`RetourCaisseRow`** (Collaborateur) —
  affichent désormais TOUS les retours d'un règlement (`retours: RetourData[]`,
  plus `retour: ... | null` unique) : chaque retour existant garde son
  propre bloc détail + son propre bouton "Modifier" (réservé au déclarant
  original, non réceptionné) ; le bouton de déclaration change de libellé
  ("Déclarer un retour de caisse" / "Déclarer un nouveau retour de
  caisse") selon qu'il en existe déjà ou non, et disparaît tant qu'un
  retour reste en attente.
- **Vérifications, parcours réel (comptes de test, rejeu réseau direct
  des Server Actions)** : retour #1 (60 000 FCFA dépensés sur un règlement
  de 100 000, 40 000 FCFA à retourner) créé puis réceptionné par
  l'Assistant Finance ; retour #2 (20 000 FCFA de dépense additionnelle)
  refusé tant que le #1 restait en attente, accepté après sa réception
  (`montantARetourner` alors `0`, conforme à la formule) ; cumul recoupé
  en base : dépenses totales = 60 000+20 000 = 80 000 FCFA, retours reçus
  = 40 000+0 = 40 000 FCFA — exactement la somme des deux retours,
  jamais seulement le dernier.

#### 3. Écran "Voir" avant "Réceptionner" (Finance/Assistant)

- **`RetoursEnAttenteTable.tsx`** — la colonne "Détail des dépenses"
  redevient un simple résumé de LECTURE (plus de `MarquerNonJustifiee`
  inline) ; la colonne "Actions" ne propose plus que "Voir" (`<Link>` vers
  `/treso/finance/retours/[id]`, même convention que "Traiter" sur
  `DemandesACategoriserTable.tsx`) — "La liste garde 'Voir' comme SEULE
  action directe" (consigne explicite), donc "Marquer non justifiée" a
  aussi été retirée de la liste, pas seulement "Réceptionner".
- **`/treso/finance/retours/[id]/page.tsx`** (nouvelle) — détail complet
  d'un retour (règlement d'origine, total dépensé, à retourner, non
  justifié, chaque `DepenseLigne` avec pièce jointe téléchargeable) ; le
  bouton **"Réceptionner"** (`ReceptionnerAction.tsx`, Client) et l'action
  **"Marquer non justifiée"** (`MarquerNonJustifiee`, réutilisée telle
  quelle) vivent désormais UNIQUEMENT ici. Même garde d'accès que la liste
  (`treso.receptionner_retour` complet, `treso.valider_demande` lecture
  seule avec bannière) — jamais un contrôle dupliqué différemment.
  Fonctionne aussi bien pour un retour Collaborateur classique que pour un
  retour créé par l'Assistant Finance (Tâches 4/5 ci-dessous), y compris
  sur une demande `CLOTUREE` (badges "Assistant Finance"/"Réouverture
  exceptionnelle" affichés le cas échéant) — c'est
  `receptionnerRetourAction` elle-même qui autorise ou refuse selon le
  contexte, jamais une condition dupliquée sur cette page.
- **Vérifications, parcours réel** : liste confirmée sans bouton
  "Réceptionner" ni "Marquer non justifiée" directs (0 occurrence) ; clic
  "Voir" → détail complet affiché (règlement, dépenses, "Total dépensé") ;
  "Réceptionner" depuis le détail fonctionne (retour passe à
  `estReceptionne: true`, confirmé en base et à l'écran).

#### 4. L'Assistant Finance déclare les dépenses sur toute demande, retour ou pas

**Diagnostic** : `marquerDepenseNonJustifieeAction` et la synthèse
automatique en ligne `SANS_PIECE` (formulaire simplifié Collaborateur)
existaient déjà, mais uniquement pour RECLASSIFIER une ligne déjà
déclarée par le collaborateur — rien ne permettait à Finance de créer
elle-même la déclaration initiale en l'absence totale de retour soumis.

- **`declarerRetourAssistantAction(reglementId, lignes, motifReouverture?)`**
  (nouvelle, `treso/finance/retours/retourActions.ts`) — réservée à
  `treso.receptionner_retour`. Réutilise directement `DepenseLigne` (même
  table, mêmes colonnes que le formulaire Collaborateur — schéma de
  validation dupliqué à dessein dans ce fichier plutôt qu'importé du
  fichier Collaborateur, pour garder les deux domaines de permission
  physiquement séparés) : montant/objet/date/nature/justification/
  commentaire/pièce jointe par ligne, motif obligatoire si `SANS_PIECE`
  (même contrainte que le formulaire détaillé du Collaborateur).
- **Ne réceptionne JAMAIS automatiquement** — crée le retour
  `estReceptionne: false`, exactement comme une déclaration normale ;
  la réception reste une action séparée
  (`receptionnerRetourAction`, inchangée). Décision délibérée : même la
  règle impérative "Déclarer un retour ≠ réceptionner un retour, deux
  actions et deux acteurs distincts" reste respectée AU NIVEAU DE
  L'ACTION (deux clics, deux écrans) même quand c'est le même Assistant
  qui se substitue au collaborateur absent pour les deux étapes — jamais
  fusionnées en une seule pour ce cas exceptionnel.
- **`RetourCaisse.creeParAssistant`** (nouveau champ, migration
  `20260922150935_retours_multiples_assistant_reouverture_exceptionnelle`) —
  `true` uniquement pour un retour créé par cette action (`declarantId`
  porte alors l'id de l'Assistant, pas du collaborateur) ; affiché comme
  badge informatif partout où un retour est listé (liste, détail, écran
  Collaborateur), jamais une condition de calcul.
- **Interface** : `RetoursCaisseFinanceSection.tsx` (nouvelle, affichée
  sur `treso/finance/demandes/[id]/page.tsx` pour TOUT statut de demande,
  y compris `CLOTUREE` — voir Tâche 5) liste, pour chaque règlement Caisse
  confirmé, ses retours existants (lien "Voir le détail") puis, si
  `treso.receptionner_retour` ET qu'aucun retour n'est déjà en attente sur
  ce règlement, le déclencheur "Aucun retour du collaborateur — déclarer
  les dépenses" (`RetourAssistantTrigger.tsx` → `DeclarerRetourAssistantForm.tsx`,
  même structure de lignes dynamiques que `RetourCaisseForm.tsx` détaillé,
  réutilise `PieceJointeUpload`). Historique : action `declaration_retour_assistant`
  (`ACTION_LABELS`, `DemandeHistorique.tsx`) — volontairement VISIBLE au
  Collaborateur (comme `declaration_retour`/`reception_retour`), jamais
  dans `ACTIONS_GESTION_INTERNE` : c'est une information sur SON ARGENT,
  pas une donnée de gestion interne à masquer.
- **Vérifications, parcours réel + rejeu réseau (comptes de test)** :
  demande réglée sans aucun retour soumis → Assistant Finance déclare via
  le vrai formulaire (upload réel d'une pièce jointe pour une ligne
  justifiée, motif obligatoire pour une ligne `SANS_PIECE`) → retour créé
  avec `creeParAssistant: true`, confirmé en base ; réceptionné avec
  succès depuis l'écran de détail (Tâche 3). Responsable Finance : ne voit
  pas le déclencheur sur son propre écran (permission absente), rejeu
  réseau direct de `declarerRetourAssistantAction` refusé
  (`"Action non autorisée."`). DG : refusé de la même façon.

#### 5. Réouverture exceptionnelle post-clôture pour retour de caisse oublié

Réutilise intégralement le mécanisme de la Tâche 4 (même action, même
formulaire) — la seule différence est le statut de la demande au moment
de l'appel.

- **`RetourCaisse.motifReouvertureExceptionnelle`** (nouveau champ,
  même migration que ci-dessus) — `null` pour tout retour normal (déclaré
  par le collaborateur, ou par l'Assistant sur une demande NON clôturée).
  `declarerRetourAssistantAction` exige ce motif (min **10 caractères**,
  plus strict que le motif de rejet habituel — 3 caractères ailleurs dans
  le module — vu la gravité de rouvrir un dossier clôturé) **uniquement**
  si `demande.statut === "CLOTUREE"` au moment de l'appel ; sinon jamais
  demandé. Historique : action DISTINCTE `reouverture_exceptionnelle_retour`
  (jamais confondue avec `declaration_retour_assistant` ni
  `declaration_retour`), également visible au Collaborateur.
- **`receptionnerRetourAction`** — sa garde `demande.statut === "CLOTUREE"`
  refuse désormais **SAUF** si `retour.motifReouvertureExceptionnelle`
  n'est pas `null` : la SEULE porte de sortie de ce verrou, et elle ne
  s'ouvre que pour CE retour précis (un `RetourCaisse` normal sur la même
  demande resterait, lui, bloqué si jamais il existait — cas impossible en
  pratique puisque `creerRetourCaisseAction` bloque déjà toute nouvelle
  déclaration Collaborateur sur une demande `CLOTUREE`).
- **Aucune autre action n'est réactivée** — `validerLignesAction`,
  `categoriserLigneAction`, `creerReglementAction`, `cloturerDemandeAction`
  n'ont reçu AUCUNE modification : leurs propres gardes de statut
  (déjà existantes, jamais touchées par cette tâche) continuent de tout
  refuser sur une demande `CLOTUREE`, motif de réouverture ou non. Le
  statut de la demande lui-même (`Demande.statut`) n'est jamais modifié
  par cette exception — reste strictement `CLOTUREE` avant, pendant et
  après, à l'affichage comme en base.
- **Vérifications, parcours réel + rejeu réseau (demande de test menée
  jusqu'à `CLOTUREE`)** :
  - Déclaration sans motif → refusée (validation zod).
  - Déclaration avec un motif de 5 caractères → refusée
    ("10 caractères minimum").
  - Déclaration avec un motif valide (une phrase complète) → acceptée,
    `motifReouvertureExceptionnelle` renseigné en base.
  - Statut de la demande confirmé `CLOTUREE` avant/après la déclaration
    (base ET affichage), jamais réapparue dans "Demandes en attente" ni
    "Retours en attente" (exclue par `RETOUR_EN_ATTENTE_WHERE`, qui filtre
    déjà les demandes `CLOTUREE` — c'est justement pourquoi cette
    réception ne pouvait se faire que depuis l'écran de détail de la
    demande/du retour, jamais depuis la liste générale).
  - Réception réussie malgré le statut `CLOTUREE` (badge "Réouverture
    exceptionnelle" visible sur l'écran de détail du retour).
  - Rejeu réseau direct de `validerLignesAction`, `categoriserLigneAction`
    et `creerReglementAction` sur cette même demande, APRÈS la réouverture
    exceptionnelle → les trois toujours refusées, chacune pour sa propre
    raison déjà existante (permission/statut de ligne déjà décidée/aucun
    montant restant à régler) — confirme qu'aucune de ces actions n'a été
    réactivée par cette tâche.

#### 6. Visibilité des pièces jointes pour le Collaborateur

Conséquence directe de la Tâche 2 (`RetoursCaisseSection` affichant
désormais TOUS les retours d'un règlement, y compris ceux créés par
l'Assistant Finance) : **aucun changement de code séparé n'a été
nécessaire** — `DetailDepenses` affichait déjà, sans condition, le lien
"Télécharger la pièce jointe" pour toute `DepenseLigne` qui en possède
une, et `GET /api/treso/pieces-jointes/[id]` autorisait déjà le créateur
de la demande (voir "Pièce jointe (fonctionnelle)") — jamais de logique
spécifique au déclarant de la ligne. Le lien est donc automatiquement
apparu, en lecture seule (aucune action de modification/suppression n'a
jamais existé sur cet écran Collaborateur), dès que la Tâche 2 a cessé de
limiter l'affichage à `retours[0]`.

**Vérification, parcours réel avec upload de fichier réel** : Assistant
Finance déclare une dépense justifiée avec une pièce jointe réellement
uploadée (formulaire réel, `PieceJointeUpload`) → réceptionnée → le
Collaborateur, sur `/treso/demandes/[id]`, voit la ligne de dépense ET le
lien "Télécharger la pièce jointe" → téléchargement réel effectué avec
succès (`200`, contenu du fichier correctement servi).

#### Vérifications transverses et nettoyage

- Aucune régression : dashboard Finance, "Retours en attente", reporting,
  "À décaisser", "Toutes les demandes" tous chargés avec succès (200,
  aucune erreur JS non interceptée) après l'ensemble des changements.
- 5 demandes de test (+ règlements, retours, lignes de dépense, pièces
  jointes, historique) créées pour l'occasion, supprimées après
  vérification. **Piège rencontré pendant le nettoyage, même leçon déjà
  documentée dans ce fichier** ("toujours annuler un règlement confirmé
  AVANT de supprimer la Demande/le Reglement sous-jacents") : les
  règlements de test ayant été créés directement en base (`estConfirme:
  true`, sans passer par `confirmerReglementAction`) pour accélérer la
  mise en place, aucune écriture `JournalCaisse` `SORTIE` ne leur
  correspondait — mais les RÉCEPTIONS de retours, elles, passaient bien
  par la vraie `receptionnerRetourAction` et ont donc créé de vraies
  écritures `JournalCaisse` `ENTREE` (80 000 FCFA au total, sur plusieurs
  écritures). Repéré en comparant le solde de caisse avant/après
  nettoyage plutôt que supposé correct ; corrigé en supprimant
  explicitement, par `demandeId`, toutes les écritures `JournalCaisse`
  liées aux demandes de test avant de supprimer ces dernières — solde de
  caisse revérifié cohérent (diminution exactement égale au total des
  écritures retirées).
- `tsc --noEmit`, `eslint` et `next build` (66 routes, dont la nouvelle
  `/treso/finance/retours/[id]`) passent sans erreur avant et après
  nettoyage. Route de diagnostic temporaire et scripts de vérification
  supprimés après usage ; dépendance `playwright` désinstallée
  (`--no-save`, jamais ajoutée à `package.json`/au lockfile).

#### Retirer la saisie de justification par le Collaborateur

Règle produit explicite : le Collaborateur ne doit **jamais** saisir
lui-même motif, justification ou pièce jointe sur un retour de caisse —
uniquement date et montant. Toute classification (justifié/non justifié,
motif, pièce jointe) reste exclusivement l'action de l'Assistant Finance,
qu'un vrai retour existe ou non (voir "L'Assistant Finance déclare les
dépenses..." ci-dessus).

**Diagnostic : le chemin détaillé existait encore, "formulaire simplifié"
n'était qu'un défaut, pas la seule option.** `RetourCaisseForm.tsx`
proposait toujours, en plus des deux champs date/montant, un lien "→
formulaire détaillé" (mode `create`) rouvrant plusieurs lignes de dépense
avec objet/justification/commentaire/pièce jointe SAISIS PAR LE
COLLABORATEUR LUI-MÊME — chemin déjà documenté dans ce fichier comme
"reste disponible... pour qui veut réellement justifier précisément" au
moment de sa création, avant que la présente règle produit ne soit
énoncée. Le mode `edit` ("Modifier" un retour pas encore réceptionné)
était, lui, TOUJOURS détaillé, sans même de mode simple.

**Corrigé — retiré de l'interface ET du type accepté par la Server Action,
pas seulement masqué** : `creerRetourCaisseAction`/`modifierRetourCaisseAction`
(`treso/demandes/[id]/retourActions.ts`) ont vu leur signature RÉDUITE de
`(reglementId, lignes: LigneDepenseInput[], dateRetour?)` à
`(reglementId, montantRetourne: number, dateRetour: string)` — le
paramètre `lignes` (objet/justification/commentaire/pièceJointeUrl
arbitraires) a été supprimé PUREMENT ET SIMPLEMENT, pas seulement ignoré :
un rejeu réseau direct ne peut plus techniquement transmettre de
justification, quel que soit le contournement de l'UI tenté. Le type
`LigneDepenseInput`/le schéma `ligneDepenseSchema` (détaillés) ont été
supprimés du fichier — plus aucune trace de saisie détaillée côté
Collaborateur.

- **`construireLigneSynthetique(montantDepense, date)`** (nouvelle,
  serveur) — génère la SEULE ligne `DepenseLigne` désormais possible pour
  un retour Collaborateur : toujours `justification: "SANS_PIECE"`,
  commentaire fixe ("Déclaration simplifiée..."), jamais de pièce jointe —
  aucune de ces valeurs n'est plus jamais lue depuis une entrée client.
  Réutilisée à l'identique par `creerRetourCaisseAction` et
  `modifierRetourCaisseAction`.
- **`RetourCaisseForm.tsx`** — réécrit : plus de `formeSimple`/toggle,
  plus de lien "formulaire détaillé", plus d'import de `Select`/`Textarea`/
  `PieceJointeUpload`/`JUSTIFICATION_OPTIONS`. Le mode `edit` (bouton
  "Modifier" d'un retour Collaborateur pas encore réceptionné) utilise
  désormais EXACTEMENT le même formulaire simple (date + montant),
  préremplis depuis `retour.dateRetour`/`retour.montantARetourner` — plus
  jamais l'ancien éditeur multi-lignes.
- **Conséquence assumée sur `modifierRetourCaisseAction`** : puisque le
  Collaborateur ne peut plus produire qu'une seule ligne synthétique,
  l'ancien diff "par id" (préservant une ligne inchangée et sa pièce
  jointe) n'a plus de sens — remplacé par un remplacement INTÉGRAL des
  lignes existantes à chaque modification. Un éventuel retour créé AVANT
  cette tâche via l'ancien formulaire détaillé (plusieurs lignes, pièces
  jointes) perdrait ce détail à la première modification suivante — aucun
  cas de ce type trouvé en pratique (voir vérifications), comportement
  documenté ici si le cas se présentait.
- **`RetourCaisseRow.tsx`** — le "Total dépensé" affiché reste inchangé
  (dérivé des `DepenseLigne` réellement en base, jamais du formulaire) ;
  seul le point d'entrée d'édition a changé de props
  (`montantRetourneInitial`/`dateRetourInitiale` au lieu de
  `lignesInitiales`).
- **Aucun changement côté Assistant Finance** — `declarerRetourAssistantAction`/
  `marquerDepenseNonJustifieeAction` (`treso/finance/retours/retourActions.ts`)
  restent la SEULE voie de classification, avec leur capacité intacte
  (objet/justification/commentaire/pièce jointe, y compris en l'absence de
  tout retour Collaborateur) — ce sont des fichiers/permissions
  entièrement distincts (`treso.receptionner_retour`, jamais
  `treso.declarer_retour`), non touchés par cette tâche.

**Vérifications, parcours réel (comptes de test réels, inspection précise
du DOM — pas un simple test de présence de mot dans la page, un contrôle
`querySelector` par type de champ)** :
- Formulaire de déclaration Collaborateur : exactement 2 champs visibles
  (Date du retour, Montant à retourner), **0 `<select>`, 0 `<textarea>`,
  0 `<input type="file">`** — confirmé par comptage direct des éléments du
  DOM, pas par recherche de texte (un premier essai de vérification par
  mot-clé a produit de faux positifs à cause du propre texte explicatif du
  formulaire — "qui se chargera elle-même de le classer... pièce jointe,
  motif" — corrigé en comptant les éléments de formulaire réels).
- Retour déclaré (montant partiel retourné) → recoupé en base : **une
  seule** `DepenseLigne`, `justification: "SANS_PIECE"`, commentaire fixe
  généré par le serveur — jamais un choix transmis par le client.
- Assistant Finance : retour bien visible dans "Retours en attente",
  "Marquer non justifiée" fonctionnelle sur la ligne synthétique,
  réception réussie ; déclencheur "Aucun retour du collaborateur —
  déclarer les dépenses" toujours disponible sur l'écran Finance (capacité
  de classification intacte, y compris après réception du retour
  Collaborateur — s'applique alors à un ÉVENTUEL futur règlement/retour,
  pas de régression).
- Collaborateur : après réception par l'Assistant, le retour s'affiche en
  lecture seule ("Réceptionné") sur son écran, sans aucun bouton "Marquer
  non justifiée" ni autre action de classification — confirmé par
  comptage (0 occurrence).
- `tsc --noEmit`, `eslint` et `next build` passent sans erreur.

### L'Assistant Finance détaille réellement le retour (remplace le générique) + signalement d'erreur par le Collaborateur

Trois tâches liées, traitées ensemble : la ligne `DepenseLigne` générique
("Dépenses non détaillées", `SANS_PIECE`) produite automatiquement par le
formulaire simplifié du Collaborateur (voir "Retirer la saisie de
justification par le Collaborateur" ci-dessus) et par
`declarerRetourAssistantAction` (cas "0 retour", voir "L'Assistant Finance
déclare les dépenses...") ne pouvait jusqu'ici qu'être marquée "non
justifiée" globalement — jamais réellement détaillée (libellé réel,
montant par nature de dépense, pièce jointe individuelle).

#### Mécanisme UNIFIÉ de détail réel (`detaillerDepensesRetourAction`)

**Une seule façon de détailler, peu importe l'origine du retour** — la
demande explicitement de ne jamais dupliquer un second mécanisme a été
respectée en reconnaissant que les deux origines (retour réellement soumis
par le Collaborateur, ou déclaré par l'Assistant en son absence) produisent
déjà exactement la même forme : un `RetourCaisse` portant une ligne
générique unique. `declarerRetourAssistantAction` (Tâche "L'Assistant
Finance déclare les dépenses...") a donc été **réduite** à
`(reglementId, motifReouverture?)` — elle ne crée plus qu'un retour +
UNE ligne générique `SANS_PIECE` couvrant tout le montant restant à
expliquer (`calculerMontantARetournerNet`, formule déjà existante,
inchangée), exactement comme le fait déjà le formulaire simplifié
Collaborateur. Le paramètre `lignes` détaillées qu'elle acceptait est
purement et simplement supprimé — plus aucune saisie de ligne à la
création, peu importe qui déclare.

- **`detaillerDepensesRetourAction(retourId, lignes: LigneDetailInput[])`**
  (nouvelle, `treso/finance/retours/retourActions.ts`) — réservée à
  `treso.receptionner_retour` (Assistant Finance uniquement, comme toutes
  les actions de ce type ; Responsable Finance et DG exclus). Remplace
  **intégralement** les lignes actuelles du retour (génériques ou déjà
  détaillées lors d'un appel précédent) par le nouveau détail — jamais un
  ajout, toujours un remplacement complet dans la même transaction
  (`deleteMany` puis recréation).
  ```ts
  interface LigneDetailInput {
    libelle: string;
    montant: number;
    pieceJointeFournie: boolean;   // état EXPLICITE, jamais déduit du silence
    pieceJointeUrl?: string;        // requis si pieceJointeFournie
    justifiee: boolean;
    motif?: string;                 // requis si !justifiee (3 caractères minimum)
  }
  ```
  `justifiee: true` → `justification: "FACTURE"` (la pièce jointe éventuelle
  faisant foi) ; `justifiee: false` → `justification: "SANS_PIECE"` +
  `motifNonJustifie`/`motifNonJustifieParId`/`motifNonJustifieAt` renseignés
  directement dans la transaction (mêmes champs que
  `marquerDepenseNonJustifieeAction`, jamais un second appel à cette
  action pour des lignes qui n'ont pas encore d'id).
- **Validation stricte du total** — la cible n'est **jamais** recalculée
  depuis `Reglement.montant` : c'est la somme des lignes ACTUELLES du
  retour (`retour.depenses`, avant remplacement) qui fait foi — cette
  action ne modifie donc jamais `montantARetourner`, seule la RÉPARTITION
  du total déjà établi change. Comparaison en centimes entiers, écart
  exact renvoyé dans le message de refus : `"La somme des lignes (X FCFA)
  ne correspond pas au total dépensé de ce retour (Y FCFA) — écart de Z
  FCFA en trop/manquant."` — vérifié en pratique (écart de 1 000 FCFA
  manquant correctement détecté et chiffré).
- **Pièce jointe, état explicite** — aucune nouvelle colonne : le SERVEUR
  refuse simplement (`superRefine` zod) toute ligne où `pieceJointeFournie:
  true` sans `pieceJointeUrl`, message "Téléversez le fichier, ou indiquez
  qu'aucune pièce jointe n'est fournie." — jamais un champ silencieusement
  vide. Réutilise `POST /api/treso/pieces-jointes/upload` tel quel (déjà
  accessible à l'Assistant Finance via sa permission
  `treso.effectuer_reglement`, faisant partie de la garde OR existante de
  cette route).

#### Verrouillage et exception ciblée — `SignalementRetour`

**Structure retenue : une table dédiée `SignalementRetour`, pas un simple
champ réutilisable sur `RetourCaisse`** (choix explicitement laissé libre
par la demande) — décision motivée par la différence de nature avec
`motifReouvertureExceptionnelle` (un champ figé, un seul usage possible par
retour) : un signalement peut légitimement se reproduire plusieurs fois
sur la vie d'un même retour (signalé → résolu → signalé à nouveau si une
nouvelle erreur est constatée), et nécessite un historique complet
auditable (qui a signalé/résolu, quand, avec quel commentaire) — un champ
unique écraserait cet historique à chaque nouveau signalement.
```prisma
model SignalementRetour {
  id             String       @id @default(cuid())
  retourCaisseId String
  retourCaisse   RetourCaisse @relation(fields: [retourCaisseId], references: [id])
  commentaire    String
  signaleParId   String
  signalePar     User         @relation("SignalementRetourSignalePar", fields: [signaleParId], references: [id])
  signaleAt      DateTime     @default(now())
  estResolu      Boolean      @default(false)
  resoluParId    String?
  resoluPar      User?        @relation("SignalementRetourResoluPar", fields: [resoluParId], references: [id])
  resoluAt       DateTime?
}
```
Migration purement additive `20260923094649_signalement_retour_detail_reel`.
Un seul signalement `estResolu: false` ("actif") autorisé à la fois par
retour — un second signalement pendant que le premier est encore actif
est refusé côté serveur (`"Un signalement est déjà en cours de traitement
pour ce retour : attendez qu'il soit résolu avant d'en soumettre un
nouveau."`), vérifié en pratique.

- **`signalerErreurRetourAction(retourId, commentaire)`**
  (`treso/demandes/[id]/retourActions.ts`, côté Collaborateur) — réservée
  à `treso.declarer_retour`, revérifie que le créateur de la demande liée
  est bien l'utilisateur connecté. Commentaire obligatoire (**10 caractères
  minimum**, même seuil que `motifReouvertureExceptionnelle` — gravité
  comparable, une erreur signalée rouvre exceptionnellement un dossier déjà
  traité). Trace une `HistoriqueEntry` (action `signalement_retour`,
  volontairement **visible** au Collaborateur — c'est sa propre action) et
  notifie l'équipe Finance via `notifierParPermission("treso.receptionner_retour",
  ...)` (mécanisme déjà existant, jamais dupliqué) — atteint donc
  spécifiquement l'Assistant Finance, jamais le Responsable Finance/DG qui
  n'ont pas cette permission.
- **Exception ciblée dans `detaillerDepensesRetourAction`** — refuse
  normalement toute modification d'un retour déjà `estReceptionne`, SAUF
  s'il existe un `SignalementRetour` actif pour ce retour précis (même
  principe que `motifReouvertureExceptionnelle`/`receptionnerRetourAction`
  pour la réouverture post-clôture, jamais un mécanisme divergent) :
  message de refus inchangé sinon
  (`"Ce retour de caisse a déjà été réceptionné : la modification du
  détail nécessite un signalement actif du collaborateur."`).
- **Auto-résolution dans la MÊME transaction** — si la correction
  s'appuie sur un signalement actif, celui-ci passe à `estResolu: true`
  (`resoluParId`/`resoluAt`) au moment même où les nouvelles lignes sont
  écrites : le retour se **reverrouille automatiquement** (sans signalement
  actif restant, une tentative suivante est refusée exactement comme
  avant tout signalement) — vérifié en pratique (nouvelle tentative après
  correction → refusée avec le même message que l'état initial).
- **Historique, action distincte** — `correction_signalement_retour`
  (jamais confondue avec `detaillage_retour`, le premier détaillage
  normal sans signalement) : "traçabilité complète et distincte de la
  correction elle-même", conformément à la demande. Les trois nouvelles
  actions (`detaillage_retour`, `signalement_retour`,
  `correction_signalement_retour`) sont ajoutées à `ACTION_LABELS`
  (`DemandeHistorique.tsx`) et **volontairement exclues** de
  `ACTIONS_GESTION_INTERNE` — restent visibles au Collaborateur, comme
  `declaration_retour_assistant`/`reouverture_exceptionnelle_retour` déjà
  documentées : c'est une information sur SON ARGENT, jamais de la
  gestion interne à masquer.
- **`supprimerUtilisateurAction`** (admin/users) étendue avec 2 relations
  supplémentaires (`signalementRetour.signaleParId`/`resoluParId`, même
  pattern exact que `motifNonJustifieParId`) — un compte ayant signalé ou
  résolu au moins une erreur ne peut plus être supprimé définitivement.

#### Le Collaborateur voit le détail réel, jamais le générique

`DetailDepenses` (`RetourCaisseRow.tsx`, côté Collaborateur, déjà
existant) affiche désormais, par ligne, dans l'ordre : le libellé réel
(`objet`, déjà affiché — reste "Dépenses non détaillées" tant que
l'Assistant n'a rien détaillé, devient le vrai libellé une fois détaillé,
sans aucun changement de code nécessaire pour ce point précis puisque le
composant lisait déjà ce champ) ; le lien "Télécharger la pièce jointe" OU
la mention **explicite** "Aucune pièce jointe fournie." (jamais un silence
muet — remplace l'ancien "Aucune pièce jointe.") ; puis un statut à trois
états, nouveau : "Justifiée." (vert) si `justification !== "SANS_PIECE"`,
"Non justifiée (auteur) : motif" (orange) si un `motifNonJustifie` existe,
ou "Détail non encore renseigné par l'équipe Finance." (neutre) pour la
ligne générique pas encore traitée — ce troisième cas couvre exactement
la période entre la déclaration et le détaillage par l'Assistant.
Toujours en LECTURE SEULE, aucune action de modification côté
Collaborateur au-delà du signalement (voir ci-dessus).

`RetoursCaisseSection.tsx` transmet désormais aussi
`motifNonJustifie`/`motifNonJustifiePar` par ligne (jamais exposés avant
cette tâche côté Collaborateur — l'auteur du motif Finance devient
visible, cohérent avec le fait que c'est son propre argent) et le
signalement **actif** éventuel de chaque retour, pour que
`SignalerErreurRetour` (nouveau, colocalisé) affiche déjà un signalement
en cours plutôt que de proposer d'en ouvrir un second voué à l'échec
serveur.

#### Vérifications, parcours réel (rejeu réseau direct via une route de diagnostic temporaire dans un vrai contexte de requête, comptes de test réels, dev server redémarré après la migration)

Méthodologie : plutôt que de deviner le protocole interne des Server
Actions Next.js, une route API temporaire (`/api/diag-tmp`, supprimée
après usage) a servi de point d'entrée pour rejouer les vraies fonctions
de Server Action dans un **vrai contexte de requête** (cookies de session
réels obtenus par une vraie connexion Auth.js/Credentials) — le contrôle
de permission (`getSession()`/`hasPermission()`) s'exécute donc
exactement comme en production, sans raccourci. Deux demandes de test
créées via le vrai formulaire (Server Action `creerDemandeAction`).

- **Scénario A (retour réellement soumis par le collaborateur)** : demande
  validée (60 000 FCFA), réglée en Caisse et confirmée, retour partiel
  déclaré par le Collaborateur (40 000 FCFA retournés, 20 000 FCFA à
  détailler → ligne générique `SANS_PIECE` auto-créée, confirmé en base).
  - Détail avec somme incorrecte (19 000 FCFA au lieu de 20 000) → refusé,
    message exact : "écart de 1 000 FCFA manquant."
  - Détail avec somme correcte (12 000 FCFA justifiée + pièce jointe PDF
    réellement uploadée, 8 000 FCFA non justifiée + motif) → réussi ;
    recoupé en base (2 lignes réelles, `pieceJointeId` renseigné sur la
    première, `motifNonJustifie` sur la seconde).
  - Page Collaborateur relue : libellés réels présents, lien "Télécharger
    la pièce jointe" présent, "Aucune pièce jointe fournie." pour la
    ligne sans pièce, "Justifiée." affiché, motif Finance affiché, **zéro
    occurrence** du texte générique "Dépenses non détaillées" — confirmé
    par recherche exacte dans le HTML rendu.
  - Responsable Finance ET DG refusés sur `detaillerDepensesRetourAction`
    (rejeu réseau direct, "Action non autorisée.").
  - Retour réceptionné (Assistant) → nouvelle tentative de modification
    SANS signalement actif → refusée avec le message de verrou attendu.
  - Signalement sans commentaire → refusé (message de validation
    zod) ; commentaire valide (>10 caractères) → accepté, notification
    créée pour l'Assistant Finance (recoupée en base, titre "Erreur
    signalée sur un retour de caisse"). Second signalement pendant que
    le premier reste actif → refusé.
  - Correction avec le signalement actif → réussie, message "Détail
    corrigé — signalement résolu, retour reverrouillé." ; recoupé en
    base : signalement passé à `estResolu: true`. Nouvelle tentative de
    modification APRÈS cette correction, sans nouveau signalement →
    refusée exactement comme avant tout signalement (reverrouillage
    confirmé).
  - Responsable Finance ET DG refusés sur `signalerErreurRetourAction`
    (rejeu réseau direct, "Action non autorisée.").
- **Scénario B (demande SANS aucun retour soumis, 0 retour)** : demande
  validée (30 000 FCFA), réglée en Caisse et confirmée, aucun retour
  déclaré par le Collaborateur. L'Assistant Finance appelle
  `declarerRetourAssistantAction` (retour + ligne générique 30 000 FCFA,
  confirmé en base) puis **le même** `detaillerDepensesRetourAction` que
  le Scénario A (20 000 FCFA justifiée + 10 000 FCFA non justifiée avec
  motif) → réussi du premier coup, confirmant le mécanisme réellement
  **unifié** — aucune divergence de comportement entre les deux origines.
  Page Collaborateur relue : les deux libellés réels présents, "Aucune
  pièce jointe fournie." affiché, badge "Déclaré par l'Assistant Finance"
  toujours présent (inchangé).
- **Nettoyage** : les 2 demandes de test (+ un troisième brouillon orphelin
  issu d'un script de vérification interrompu en cours de route) et toutes
  leurs entités liées (lignes, règlements, retours, dépenses, signalements,
  allocations, historique, écritures `JournalCaisse`) supprimés
  explicitement par `demandeId` — solde de caisse revérifié identique
  avant/après (4 480 000 FCFA). Route de diagnostic temporaire et scripts
  de vérification supprimés après usage.
- `tsc --noEmit` et un vrai `next build` passent sans erreur après
  nettoyage.

### Blocage du règlement Caisse si solde insuffisant

**Diagnostic** : `getSoldeCaisse()` (`backend/src/tresorerie.ts`, déjà
réutilisée par `SoldeCaisseTrendChart`/le dashboard Finance) existait déjà
et restait la seule source de vérité du solde — mais `confirmerReglementAction`
ne la consultait jamais avant de confirmer un règlement `CAISSE` : rien
n'empêchait de faire passer la caisse en négatif (le contrôle bloquant
existant à cet endroit ne portait que sur le budget partagé par Catégorie,
jamais sur le solde de caisse lui-même).

- **Contrôle ajouté dans `confirmerReglementAction`**, juste après le
  contrôle de budget déjà existant, **uniquement pour `mode: "CAISSE"`**
  (un règlement `BANQUE` n'est jamais concerné, conformément à la règle
  impérative n°3 du module) : si `montant du règlement > getSoldeCaisse()`,
  refuse avec un message citant les deux montants et renvoyant
  explicitement vers "Nouvelle alimentation de caisse" (le bouton déjà
  existant sur `/treso/finance/solde-ouverture`) :
  `"Solde de caisse insuffisant : X FCFA disponibles pour un règlement de Y
  FCFA — réalimentez la caisse (« Nouvelle alimentation de caisse ») avant
  de confirmer."`
- **Réutilise `getSoldeCaisse()` telle quelle** — aucune nouvelle fonction
  de calcul créée. Le règlement en cours de confirmation est encore
  `estConfirme: false` au moment de l'appel, donc pas encore compté dans
  le solde retourné : comparaison directe, sans avoir besoin de l'exclure
  explicitement.
- **Portée volontairement limitée à la confirmation** (`confirmerReglementAction`) —
  `creerReglementAction` (création du brouillon) n'a reçu aucun contrôle
  équivalent : un brouillon Caisse peut toujours être créé même si son
  montant dépasse le solde actuel (le solde peut changer entre la création
  du brouillon et sa confirmation, ex: une alimentation de caisse entre
  les deux) — seule la confirmation, moment où l'argent sort réellement,
  est le bon endroit pour ce contrôle, cohérent avec le contrôle de budget
  déjà en place au même endroit.

**Vérifications, parcours réel + rejeu réseau direct (comptes de test)** :
- Demande de test validée à un montant délibérément supérieur au solde de
  caisse (solde + 100 000 FCFA) → règlement Caisse créé en brouillon avec
  succès (`creerReglementAction`, jamais bloquée à cette étape) → tentative
  de confirmation (`confirmerReglementAction`, rejeu réseau direct) →
  **refusée**, message exact confirmé (montants corrects, mention du
  bouton d'alimentation).
- **Règlement Banque du même montant, sur la même demande** → créé ET
  confirmé sans aucun blocage (jamais concerné par le solde de caisse) —
  confirme la portée `mode: "CAISSE"` uniquement.
- **Alimentation de caisse réelle** (`alimenterCaisseAction`, montant
  suffisant pour couvrir l'écart, pièce jointe réellement uploadée) →
  solde de caisse recoupé en base après alimentation → le règlement Caisse
  précédemment refusé est confirmé avec succès une fois le solde suffisant
  (après avoir annulé le règlement Banque de test pour libérer le reste à
  régler consommé par ce dernier — sans rapport avec le contrôle de solde
  lui-même, contrainte de test uniquement).
- Nettoyage complet : demandes de test et leurs règlements/lignes/historique
  supprimés, écriture `JournalCaisse` de l'alimentation de test retrouvée
  précisément via son `HistoriqueEntry` (motif distinctif) et supprimée —
  solde de caisse revérifié identique avant/après (4 480 000 FCFA).
- `tsc --noEmit` et un vrai `next build` (65 routes) passent sans erreur.

### Aucune date dans le passé (demande et retour de caisse)

**Diagnostic** : deux champs de date saisis manuellement existaient déjà,
aucun des deux ne refusait une date passée.
- **Création de demande** — "Date de livraison souhaitée"
  (`Demande.dateLivraisonSouhaitee`, champ optionnel de l'en-tête,
  `DemandeForm.tsx`/`creerDemandeAction`) : validée uniquement pour son
  format (`Date.parse`), jamais pour sa position dans le temps.
- **Retour de caisse** — "Date du retour" (`RetourCaisseForm.tsx`,
  `creerRetourCaisseAction`/`modifierRetourCaisseAction`) : déjà contrainte
  à ne pas précéder le dernier règlement confirmé sur la demande
  (`getDateDernierReglementConfirme`, voir "Libellés et validations sur le
  formulaire de retour") — mais rien n'empêchait une date dans le passé
  par ailleurs (ex: une demande dont le dernier règlement remonte à
  plusieurs mois autoriserait n'importe quelle date passée après cette
  borne).

**Contrainte ajoutée aux deux endroits, jamais en remplacement de
l'existant** — comparaison en granularité JOUR (chaînes `YYYY-MM-DD`),
même convention que le reste du module : la date du jour reste autorisée
(`>=`, jamais `>`), toute date future reste autorisée.

- **`demandeSchema.dateLivraisonSouhaitee`** (`treso/demandes/nouvelle/actions.ts`)
  — second `.refine()` ajouté au schéma zod déjà existant :
  `v >= new Date().toISOString().slice(0, 10)`. Champ toujours optionnel
  (`!v || ...`) — l'absence de date n'est jamais concernée.
  `DemandeForm.tsx` : `min={aujourdHui}` + `hint="Ne peut pas être dans le
  passé."` sur l'`Input`, confort de saisie seulement, revérifié de toute
  façon côté serveur.
- **`dateRetourSchema`** (`treso/demandes/[id]/retourActions.ts`, partagée
  par `creerRetourCaisseAction`/`modifierRetourCaisseAction`) — même
  second `.refine()` ajouté à ce schéma UNIQUE (jamais dupliqué), donc les
  deux actions en héritent automatiquement. **Les deux contraintes
  s'appliquent simultanément** : le refus "pas dans le passé" est vérifié
  par ce refine avant même que l'action ne charge le dernier règlement
  confirmé ; le refus "pas avant le dernier règlement" (contrôle déjà
  existant, inchangé) s'applique ensuite — la plus restrictive des deux
  l'emporte naturellement, sans logique de combinaison explicite à écrire.
  `RetourCaisseForm.tsx` : `dateMinEffective` = la PLUS RÉCENTE de
  `aujourdHui` et `dateMin` (la date du dernier règlement, si fournie),
  posée comme `min` du champ — jamais un simple remplacement de `dateMin`,
  les deux bornes coexistent et c'est la plus contraignante qui pilote le
  champ.

**Point signalé, non tranché unilatéralement** — la demande anticipait
explicitement la question "si un flux existant crée déjà des demandes/
retours avec une date passée par défaut, ce qui casserait avec cette
nouvelle règle" : vérifié qu'aucun flux du projet ne le fait.
`dateLivraisonSouhaitee` est toujours soit omise (valeur par défaut vide
côté formulaire, `useState("")`), soit saisie explicitement par le
Collaborateur — jamais pré-remplie avec une date passée par le code.
`RetourCaisseForm` initialise sa date à `dateRetourInitiale ?? new
Date().toISOString().slice(0, 10)` (aujourd'hui), jamais une date passée
par défaut. Aucune régression trouvée, mais signalé explicitement comme
demandé plutôt que simplement affirmé sans vérification.

**Vérifications, parcours réel + rejeu réseau direct (comptes de test)** :
- Création de demande avec date de livraison **hier** → refusée
  (`fieldErrors.dateLivraisonSouhaitee`, formulaire ET rejeu réseau
  direct) ; **aujourd'hui** → acceptée ; **demain** → acceptée.
- Retour de caisse avec date **hier** → refusé
  (`"La date du retour ne peut pas être dans le passé."`).
- Retour de caisse avec date **aujourd'hui**, égale à la date de
  confirmation réelle du dernier règlement → accepté (les deux contraintes
  satisfaites simultanément, le cas normal).
- **Cas combiné isolé sur un règlement dédié** (`confirmeAt` avancé
  artificiellement à demain via une écriture directe — un règlement ne
  peut jamais être confirmé dans le futur en usage réel, ce cas n'existe
  donc que pour exercer les DEUX contraintes indépendamment) : date de
  retour **aujourd'hui** (pas dans le passé) mais **avant** ce règlement
  confirmé "demain" → refusée par la règle déjà existante ("dernier
  règlement confirmé"), confirmant que les deux contraintes s'appliquent
  bien ensemble et non l'une en remplacement de l'autre ; date **demain**
  (valide sur les deux critères à la fois) → acceptée.
- Nettoyage complet : demandes de test et règlements associés supprimés ;
  solde de caisse revérifié identique avant/après.
- `tsc --noEmit` et un vrai `next build` (65 routes) passent sans erreur.

### Finance peut définir le budget d'une catégorie, comme l'Admin

**Diagnostic** : `modifierBudgetCategorieAction` (`admin/categories/actions.ts`)
était réservée à `isAdmin()` seul — décision antérieure explicite du
projet ("le toggle et le budget restent réservés à l'Admin", voir "Gestion
des Catégories/Objets ouverte à Finance"), jamais remise en cause jusqu'ici.
La demande actuelle étend spécifiquement le BUDGET au Responsable Finance,
sans toucher au toggle Activer/Désactiver ni à l'Assistant Finance.

- **`peutModifierBudget()`** (nouvelle, `admin/categories/actions.ts`) —
  `isAdmin()` OU (`treso.valider_demande` ET PAS
  `treso.approuver_validation_complete`). **`treso.valider_demande` seule
  ne suffit pas** : le rôle DG la possède aussi (il valide/rejette les
  demandes au même titre que Finance) — même conflit de spécification déjà
  rencontré et tranché de façon identique pour "Restreindre 'Déléguer des
  accès'"/"Description du besoin modifiable" (voir CLAUDE.md) : la seconde
  condition exclut spécifiquement le DG (`treso.approuver_validation_complete`,
  jamais transmise à Finance dans le seed) sans jamais comparer de nom de
  rôle en dur. **Décision appliquée par cohérence avec ce précédent
  répété du projet, pas explicitement demandée pour cette tâche précise**
  (signalé ici plutôt que tranché silencieusement) : le DG ne peut de
  toute façon pas atteindre `/treso/finance/categories`
  (`treso.gerer_categories` absente de son rôle), donc cette exclusion
  n'a d'effet concret qu'en cas de rejeu réseau direct par un compte DG.
  L'Assistant Finance n'a de toute façon jamais `treso.valider_demande` —
  exclu structurellement, sans logique supplémentaire nécessaire pour lui.
- **`CategoriesList.tsx`** — nouvelle prop `canModifierBudget` (défaut =
  `isAdmin`, pour ne rien changer à l'appel existant depuis
  `/admin/categories`, où l'Admin garde son accès inchangé), DISTINCTE de
  `isAdmin` : pilote désormais SEULE l'affichage du bloc "Budget alloué"
  (`BudgetAlloueField`), jamais fusionnée avec `isAdmin` qui continue de
  piloter Activer/Désactiver seul, resté réservé à l'Admin, inchangé.
- **`treso/finance/categories/page.tsx`** — calcule `canModifierBudget`
  avec EXACTEMENT la même garde que `peutModifierBudget()` côté serveur
  (jamais une condition divergente entre l'affichage et la Server Action),
  la transmet à `CategoriesList`.
- **Toggle Activer/Désactiver — inchangé**, toujours réservé à `isAdmin()`
  seul (`toggleCategorieActiveAction`), jamais touché par cette tâche.

**Vérifications, parcours réel + rejeu réseau direct (comptes de test)** :
- Catégorie de test créée par Finance (`treso.gerer_categories`, mécanisme
  déjà existant, inchangé) → Responsable Finance modifie son budget
  (`modifierBudgetCategorieAction`, rejeu réseau direct) → **réussi**,
  recoupé en base (500 000 FCFA).
- Assistant Finance tente de modifier ce même budget → **refusé**
  (`"Action non autorisée."`), budget resté inchangé en base après la
  tentative.
- DG tente de modifier ce même budget (rejeu réseau direct, bien qu'il ne
  puisse pas atteindre la page elle-même) → **refusé**, même raison.
- Toggle Activer/Désactiver sur cette catégorie : Finance → refusé
  (`"Action non autorisée."`) ; Admin → réussi (catégorie désactivée avec
  succès) — comportement strictement inchangé.
- Nettoyage : catégorie de test supprimée après vérification.
- `tsc --noEmit` et un vrai `next build` (65 routes) passent sans erreur.

### Bon de caisse et reçu PDF

Deux documents PDF distincts par règlement, mêmes règles d'accès (401 non
authentifié, 404 introuvable/non confirmé, 403 sinon) : Finance/DG (une des
permissions `categoriser_demande`/`valider_demande`/`effectuer_reglement`/
`receptionner_retour`/`voir_dashboard_finance`), **ou** le créateur de la
demande.

- **Reçu** (`GET /api/treso/reglements/[id]/recu`) — document complet :
  montant validé, montant du règlement, total réglé à ce jour, solde validé
  restant à régler, bénéficiaire, validateur(s), régleur.
- **Bon de caisse** (`GET /api/treso/reglements/[id]/bon-de-caisse`) —
  uniquement pour un règlement `mode: CAISSE` (400 sinon), volontairement
  minimaliste : affiche **seulement** le montant de ce règlement précis,
  jamais le montant demandé/validé/reste à régler.

### Dépense directe

Finance peut créer une demande pour un bénéficiaire qui n'intervient pas
lui-même (prime de stage, dotation carburant, dépense entreprise,
collective) : `Demande.typeDemande` (`STANDARD`/`DEPENSE_DIRECTE`),
`natureDepenseDirecte`. Permission dédiée `treso.saisir_depense_directe`
(Finance uniquement, pas le DG). Une fois créée, suit exactement le même
circuit qu'une demande standard (validation, règlement, fonds remis,
clôture). Le bénéficiaire, même s'il a un compte Collaborateur, ne voit
jamais cette demande dans son propre « Mes demandes » (filtré par
créateur, jamais par bénéficiaire).

### Verrou de clôture — validation complète du DG

Concerne **uniquement** la clôture, jamais le règlement (une demande peut
être intégralement réglée sans aucune intervention du DG).

- `Demande.validationCompleteParDG` / `dgApprobateurId` / `dgApprouveAt`.
- `approuverValidationCompleteAction` — réservée à
  `treso.approuver_validation_complete` (DG uniquement dans le seed),
  possible dès que `montantValide > 0` (pas besoin d'attendre une
  validation totale). Pas de retrait direct.
- `rejeterValidationCompleteAction` (avant approbation) et
  `annulerValidationCompleteAction` (après approbation, motif obligatoire)
  — aucune des deux n'édite l'historique : chaque décision crée une
  **nouvelle** `HistoriqueEntry`, jamais une réécriture. L'annulation est
  refusée si la demande est déjà `CLOTUREE`.
- `cloturerDemandeAction` refuse tant que `validationCompleteParDG` n'est
  pas `true` — seule condition ajoutée, avant toute la logique métier
  existante de clôture (totale : motif libre ; partielle : motif
  obligatoire).

**Vérification de la règle de clôture à double validation — diagnostic
demandé par Finance/DG, AUCUN écart de code trouvé.** Signalement : le DG
aurait pu « valider complètement » une demande sans que ça corresponde au
comportement attendu (règle non négociable : règlement possible sans le
DG, mais clôture exigeant DEUX actions distinctes — approbation DG PUIS
clôture Finance, jamais l'une sans l'autre ni l'inverse).

- **Séparation par permission, vérifiée dans le seed ET dans la base de
  dev partagée** (requête directe sur `RolePermission`) : le rôle « DG »
  n'a jamais `treso.cloturer_demande`, le rôle « Finance » n'a jamais
  `treso.approuver_validation_complete` — aucun rôle métier réel ne cumule
  les deux (seule l'exception déjà connue et documentée du rôle « Admin »,
  hors circuit métier normal, les cumule).
- **Reproduit en pratique de bout en bout** (comptes de test réels
  Finance/DG/Collaborateur, demande jetable créée pour l'occasion,
  Server Actions appelées directement avec vérification de permission
  intacte, état relu en base à chaque étape — jamais une simple lecture de
  code) :
  1. Finance tente `cloturerDemandeAction` AVANT toute approbation DG →
     refusé (`"La clôture nécessite l'approbation complète du DG au
     préalable."`), confirmé par le message ET par le statut inchangé en
     base.
  2. DG appelle `approuverValidationCompleteAction` → succès,
     `validationCompleteParDG` passe à `true` en base — **mais le
     `statut` de la demande reste strictement inchangé**
     (`VALIDEE_NON_REGLEE` dans le test, jamais `CLOTUREE`) : cette action
     ne fait QUE déverrouiller, elle ne clôture jamais rien par
     elle-même.
  3. DG tente `cloturerDemandeAction` directement → refusé
     (`"Action non autorisée."`, `treso.cloturer_demande` absente de son
     rôle) : le DG ne peut structurellement pas clôturer seul, même après
     sa propre approbation.
  4. Finance appelle enfin `cloturerDemandeAction` → succès, `statut`
     passe à `CLOTUREE` en base seulement à cette étape.
- **Conclusion : comportement déjà rigoureusement conforme à la règle des
  deux validations, à chaque étape, prouvé par l'état réel en base et non
  par supposition.** Aucun correctif de logique nécessaire.
- **Cause probable de la confusion, corrigée par un seul ajout d'affichage** :
  un DG n'a jamais accès à la section « Clôture » (`ClotureActions.tsx`,
  visible seulement avec `treso.cloturer_demande`) — après avoir approuvé,
  son écran ne montre plus qu'une confirmation d'approbation, sans aucune
  indication que Finance doit encore agir séparément. Combiné au fait
  qu'une demande déjà réglée affiche un badge de statut « Réglée » en vert
  (succès), un DG peut raisonnablement conclure que son approbation a
  terminé le dossier. **Correctif appliqué** (`treso/finance/demandes/[id]/page.tsx`) :
  une phrase explicite («&nbsp;Cette approbation ne clôture pas la
  demande : elle reste ouverte tant que l'équipe Finance n'a pas elle-même
  cliqué sur «&nbsp;Clôturer&nbsp;».&nbsp;») s'affiche désormais après une
  approbation DG tant que la demande n'est pas `CLOTUREE`, **uniquement**
  pour un lecteur qui n'a pas `treso.cloturer_demande` (donc jamais
  affichée à Finance, qui voit déjà les boutons de clôture juste en
  dessous — pas de message redondant). Aucun changement de logique, aucune
  nouvelle permission, aucune nouvelle action.
- Nettoyage : demande de test, règlement (annulé pour neutraliser son
  écriture `JournalCaisse`), et historique associés supprimés après
  vérification.

### Séparation Responsable Finance / Assistant Finance (2026-09-21)

Séparation stricte des tâches (segregation of duties) au sein de l'équipe
Finance — objectif business confirmé : réduire le risque de fraude en
s'assurant qu'une seule personne ne peut jamais à la fois valider une
dépense ET la régler. Le rôle « Finance » existant (dans son usage métier
« Responsable Finance ») garde la décision (valider/rejeter, clôturer,
alimentation caisse/solde d'ouverture/dépense directe) ; un nouveau rôle
fixe « Assistant Finance » reçoit l'exécution (règlement/décaissement,
réception des retours de caisse).

**Diagnostic préalable (avant toute modification)** — trois actions à
isoler ou confirmer déjà isolées :

| Action | État trouvé |
|---|---|
| `validerTotalementAction`/`validerPartiellementAction`/`rejeterDemandeAction` | Déjà `treso.valider_demande`, isolée — inchangé. |
| `confirmerReglementAction`/`creerReglementAction`/`modifierReglementAction`/`annulerReglementAction` | Déjà `treso.effectuer_reglement`, isolée — inchangé dans son principe, retirée du rôle Finance (voir plus bas). |
| Réception de retour / `marquerDepenseNonJustifieeAction` | Déjà `treso.receptionner_retour`, isolée — inchangé dans son principe, retirée du rôle Finance (voir plus bas). |
| `alimenterCaisseAction` | **PAS isolée** : gardée par `isAdmin() OU treso.effectuer_reglement`, une vérification PARTAGÉE avec le règlement, jamais une permission dédiée. |
| `definirSoldeOuvertureAction`/`corrigerSoldeOuvertureAction` | **PAS isolées** : même garde partagée `isAdmin() OU treso.effectuer_reglement` que l'alimentation — les trois actions du module solde d'ouverture ne faisaient techniquement qu'une seule et même vérification. |
| `creerDepenseDirecteAction` | **Déjà isolée** : `treso.saisir_depense_directe`, une permission dédiée de longue date — aucune isolation nécessaire. |

**Isolation de deux nouvelles permissions** — `treso.alimenter_caisse` et
`treso.corriger_solde_ouverture` (cette dernière couvre volontairement À
LA FOIS `definirSoldeOuvertureAction` — la définition initiale, unique —
ET `corrigerSoldeOuvertureAction` — la correction ultérieure : même écran,
même concept métier de « gérer le solde d'ouverture », jamais deux
permissions pour deux actions du même formulaire). Les trois Server
Actions du fichier `solde-ouverture/actions.ts` pointent désormais vers
ces permissions dédiées au lieu de `treso.effectuer_reglement`.

**Nouveau rôle fixe « Assistant Finance »** — `estAdmin: false`,
`peutRecevoirFeedback: true` (comme les autres rôles non-Admin, valeur par
défaut du champ), **`peutEtreBeneficiaireDelegation: true` DÈS LA
CRÉATION** (voir "Délégation individuelle de permissions" — second cas
explicite après « Collaborateur », pas un oubli : un Responsable Finance
doit pouvoir déléguer au cas par cas l'une des trois actions que
l'Assistant n'a pas par défaut). Permissions par défaut : uniquement
`treso.effectuer_reglement` + `treso.receptionner_retour`.

**Retrait DÉFINITIF sur le rôle « Finance »** (choix produit assumé et
daté 2026-09-21, **volontairement PAS documenté comme un correctif de
bug** — le comportement précédent n'était pas un défaut, c'était le
fonctionnement voulu avant cette tâche) : `treso.effectuer_reglement` et
`treso.receptionner_retour` retirées de ses `RolePermission`, désormais
l'exclusivité du rôle « Assistant Finance ». Le rôle Finance gagne en
contrepartie `treso.alimenter_caisse`/`treso.corriger_solde_ouverture`
(aucune régression : il les avait déjà implicitement via l'ancienne garde
partagée).

- Migration `20260921000000_separation_finance_responsable_assistant`
  (idempotente, `ON CONFLICT DO NOTHING` partout — même schéma que les
  rattrapages `feedback.moderer` précédents) : crée les deux permissions,
  les attribue à Finance, crée le rôle Assistant Finance avec ses deux
  permissions par défaut, puis retire `effectuer_reglement`/
  `receptionner_retour` du rôle Finance. `seed.ts` mis à jour en parallèle
  (nouveau rôle, nouvelles permissions, `rolePermissionMap` réécrite,
  nouveau compte de test `assistant-finance@simassurances.test`) pour
  qu'une base neuve obtienne directement le bon état sans dépendre de
  cette migration.
- `treso/finance/layout.tsx` — **aucune modification de logique
  nécessaire** : la garde OR admettait déjà `treso.effectuer_reglement`/
  `treso.receptionner_retour`, donc le nouveau rôle Assistant Finance y
  accède directement sans changement (confirmé en pratique). Les deux
  nouvelles permissions y ont tout de même été ajoutées par principe (voir
  "Aide-mémoire — permissions actuelles").

**Boutons visibles mais désactivés, jamais absents** (au lieu du masquage
conditionnel `{canX ? <Action/> : null}` déjà en place ailleurs dans le
module) — changement de convention volontaire pour cette tâche
spécifiquement, afin que la séparation des tâches soit LISIBLE sur l'écran
plutôt que de disparaître silencieusement :

- **`ValidationActions.tsx`** — nouvelle prop `disabled` (remplace le
  masquage `{canValider ? ... : null}` de la page appelante) : les 3
  boutons restent visibles, désactivés + message explicite si `disabled`.
- **`ReglementForm.tsx`** (bouton d'entrée "Ajouter un règlement") et
  **`ReglementRow.tsx`** (Modifier/Confirmer/Annuler par règlement) — même
  principe, nouvelle prop `disabled`/reprise de `canEffectuerReglement`
  sans plus jamais conditionner le RENDU du bouton, seulement son état.
  `ReglementsSection.tsx` : `resteARegler > 0` reste la seule condition
  d'affichage (état métier, jamais une permission).
- **`solde-ouverture/page.tsx`** — garde de PAGE élargie (Admin OU
  `corriger_solde_ouverture` OU `alimenter_caisse` OU
  `effectuer_reglement` OU `receptionner_retour`) : un Assistant Finance
  sans délégation doit pouvoir ATTEINDRE cette page pour voir ses boutons
  désactivés, pas se heurter à une redirection en amont. `SoldeOuvertureForm`/
  `SoldeOuvertureCorrection` reçoivent chacun leur(s) prop(s)
  `disabled`/`canCorriger`/`canAlimenter` — les deux boutons d'entrée de
  `SoldeOuvertureCorrection` ("Corriger le solde d'ouverture" et "Nouvelle
  alimentation de caisse") se désactivent indépendamment l'un de l'autre
  (un compte peut avoir reçu une délégation sur l'un sans l'autre).
- **`depenses-directes/nouvelle/page.tsx`** — même principe : garde de
  page élargie (`saisir_depense_directe` OU `effectuer_reglement` OU
  `receptionner_retour`), `DepenseDirecteForm` reçoit `disabled` (désactive
  uniquement le bouton de soumission, tous les champs restent
  consultables/remplissables — l'autorité réelle reste la Server Action).
- **Nav (`(dashboard)/layout.tsx`)** — `canGererSoldeOuverture`/
  `canSaisirDepenseDirecte` élargis avec la même liste de permissions que
  les gardes de page correspondantes, pour que le lien apparaisse dans la
  sidebar de l'Assistant Finance sans délégation (sinon la page serait
  atteignable par URL directe mais jamais découvrable).
- **`/treso/finance/retours` ("Retours en attente")** : à l'origine
  volontairement PAS étendu, laissé en `redirect()` strict sur
  `treso.receptionner_retour` seule — point explicitement signalé sans
  être tranché unilatéralement. **Résolu par la tâche suivante** ("Accès
  lecture seule du Responsable Finance à Retours en attente" ci-dessous) :
  le Responsable Finance y a désormais bien un accès de consultation
  complet, boutons visibles mais désactivés — plus un point ouvert.

**Vérifications, parcours réel + rejeux réseau (comptes de test
uniquement, aucune donnée réelle touchée)** :

- **Assistant Finance** : demande de test vue avec boutons
  validation/rejet visibles et désactivés (`disabled=""` confirmé dans le
  HTML rendu, message explicite affiché) ; rejeu réseau direct de
  `validerTotalementAction` → refusé (`"Action non autorisée."`).
- **Finance (Responsable)** valide normalement la même demande
  (`validerTotalementAction` → succès, statut `VALIDEE_NON_REGLEE`
  confirmé en base).
- **Une fois validée**, Finance voit "Ajouter un règlement" visible mais
  désactivé (`disabled=""` + message confirmés dans le HTML) ; rejeu
  réseau direct de `confirmerReglementAction` (avec un id de règlement
  arbitraire, le contrôle de permission précède toute lecture DB) →
  refusé.
- **Assistant Finance effectue alors, pour de vrai, tout le cycle
  d'exécution sur cette même demande** : crée le règlement (brouillon),
  le confirme (`JournalCaisse` SORTIE créée), puis réceptionne le retour
  déclaré par le collaborateur (`JournalCaisse` ENTREE créée) — les trois
  appels réussissent.
- **Finance garde "Nouvelle alimentation de caisse"/"Corriger le solde
  d'ouverture"/"Nouvelle dépense directe" pleinement fonctionnels** :
  les trois exécutées pour de vrai avec succès (petits montants de test,
  nettoyés après coup — la correction du solde d'ouverture à l'identique
  a un impact net nul par construction, les deux alimentations de test
  d'1 FCFA ont été supprimées directement, faute de mécanisme de
  compensation pour cette action précise).
- **Assistant Finance ne peut faire aucune des trois par défaut** : les
  trois rejeux réseau directs refusés (`"Action non autorisée."`).
- **Délégation ciblée testée pour de vrai** : Finance délègue
  `treso.alimenter_caisse` à l'Assistant Finance via
  `accorderDelegationAction` (le vrai flux de `/delegations`) →
  l'Assistant peut alors effectuer une alimentation de caisse réelle,
  **mais reste refusé sur les deux autres actions non déléguées**
  (`corrigerSoldeOuvertureAction`/`creerDepenseDirecteAction`) — plafond
  strict confirmé. Délégation révoquée après vérification
  (`revoquerDelegationAction`).
- **Flux complet de bout en bout, sans régression sur le verrou de
  clôture déjà vérifié** (voir "Vérification de la règle de clôture à
  double validation" ci-dessus) : demande créée (collaborateur) →
  Responsable Finance valide → Assistant Finance règle et réceptionne →
  Finance tente de clôturer AVANT l'approbation DG → refusé → DG approuve
  la validation complète (`validationCompleteParDG` passe à `true`,
  statut inchangé) → **Assistant Finance tente de clôturer → refusé**
  (`treso.cloturer_demande` reste l'exclusivité du rôle Finance, jamais
  donnée à l'Assistant) → Finance clôture → succès. Confirme qu'aucune
  régression n'a été introduite sur cette logique déjà vérifiée
  précédemment.
- Compte de test `assistant-finance@simassurances.test` créé directement
  en base (seed non rejoué sur cette base de dev partagée, comme pour
  toute nouvelle donnée de seed sur une base déjà initialisée) avec les
  mêmes paramètres que `seed.ts` — conservé comme fixture permanente,
  même statut que les 5 autres comptes de test. Demandes/règlements/
  retours/historique de test supprimés après vérification ; solde de
  caisse revérifié identique avant/après (4 975 000 FCFA).
- `tsc`/`eslint` clean, vrai `next build` réussi (65 routes).

### Accès lecture seule du Responsable Finance à Retours en attente

Suite directe de la tâche ci-dessus : le Responsable Finance, désormais
dépourvu de `treso.receptionner_retour`, se retrouvait totalement
redirigé hors de `/treso/finance/retours` ("Retours en attente") — point
explicitement signalé sans être tranché unilatéralement. Demande
confirmée : garder un accès de CONSULTATION complet (montants,
collaborateurs, statuts), boutons d'action visibles mais désactivés,
jamais un redirect.

- **`retours/page.tsx`** — la garde devient `treso.receptionner_retour`
  **OU** `treso.valider_demande` : le premier obtient un accès complet
  (`disabled={false}`), le second un accès lecture seule
  (`disabled={true}`, bannière explicite en haut de page). Un compte
  n'ayant NI L'UNE NI L'AUTRE (DG, Collaborateur) reste redirigé — dans la
  pratique via la garde plus générale de `finance/layout.tsx` en amont
  (aucune des deux permissions ne fait partie de son ensemble de
  permissions Trésorerie), jamais atteint le `redirect()` propre à cette
  page, mais le résultat observable (redirection) est strictement
  identique à avant.
- **`RetoursEnAttenteTable.tsx`** — nouvelle prop `disabled`, propagée au
  bouton "Réceptionner" (colonne Actions) et à `MarquerNonJustifiee`
  (colonne "Détail des dépenses") : les deux restent visibles, jamais
  retirés du rendu.
- **`MarquerNonJustifiee.tsx`** (partagé avec `RegularisationSummary.tsx`,
  voir "Détail des dépenses sur l'écran de Régularisation") — nouvelle
  prop `disabled` : désactive uniquement le DÉCLENCHEUR ("Marquer non
  justifiée"), jamais le motif déjà enregistré (toujours affiché en pure
  lecture, sans rapport avec `disabled`). L'appel depuis
  `RegularisationSummary` reste inchangé (non concerné, cette tâche ne
  touche que la liste agrégée `/treso/finance/retours`).
- **Message explicite plutôt qu'une répétition par ligne** — une seule
  bannière en tête de page ("Consultation en lecture seule : ...") au lieu
  d'un texte explicatif sous CHAQUE bouton désactivé (contrairement au
  reste du module, ex: `ValidationActions`) : cette page est une liste
  avec potentiellement plusieurs dizaines de lignes, répéter la même
  phrase sous chaque bouton "Réceptionner" et chaque "Marquer non
  justifiée" aurait été redondant et bruyant — adaptation délibérée du
  principe "visible mais désactivé", pas un oubli du message explicatif.

**Vérifications, parcours réel + rejeux réseau (comptes de test
uniquement, aucune donnée réelle touchée)** :

- Demande de test créée → validée (Responsable Finance) → réglée et
  confirmée (Assistant Finance, `treso.effectuer_reglement`) → retour
  déclaré par le collaborateur avec une ligne `SANS_PIECE` (pour exercer
  aussi "Marquer non justifiée").
- **Responsable Finance** : page chargée avec succès (200, jamais un
  redirect), bannière lecture seule présente, liste complète visible
  (référence, collaborateur, montant, mode CAISSE), bouton "Réceptionner"
  ET déclencheur "Marquer non justifiée" tous deux confirmés
  `disabled=""` dans le HTML rendu. Rejeu réseau direct de
  `receptionnerRetourAction` → refusé (`"Action non autorisée."`).
- **Assistant Finance** : page chargée sans la bannière lecture seule,
  bouton "Réceptionner" confirmé SANS `disabled` dans le HTML (seul
  `aria-busy="false"` présent) — puis réceptionne réellement le retour
  avec succès, sans aucune régression par rapport au comportement
  d'avant cette tâche.
- **Collaborateur** (ni `receptionner_retour` ni `valider_demande`) :
  toujours redirigé (intercepté par la garde de `finance/layout.tsx` en
  amont, résultat final identique à avant cette tâche).
- **Piège rencontré et corrigé pendant le nettoyage** : après suppression
  directe de la demande de test, les deux écritures `JournalCaisse`
  qu'elle avait produites (SORTIE 15 000 du règlement, ENTREE 0 de la
  réception) ont survécu avec `demandeId` mis à `null`
  (`JournalCaisse.demandeId` est une relation optionnelle, comportement
  Prisma par défaut `SET NULL` — jamais un blocage de suppression), un
  déséquilibre permanent de -15 000 FCFA sans rapport avec cette tâche
  elle-même. Repéré en revérifiant le solde de caisse avant/après
  nettoyage (4 960 000 au lieu des 4 975 000 attendus) plutôt que supposé
  correct — corrigé en supprimant directement ces deux écritures
  devenues orphelines (aucune information reconstituable ne s'y
  rattachait plus une fois `demandeId` nul, contrairement à une écriture
  encore liée à une vraie demande). Solde de caisse revérifié restauré
  à 4 975 000 FCFA. Enseignement pour toute future tâche de ce type :
  toujours annuler un règlement confirmé (`annulerReglementAction`, crée
  l'écriture compensatoire) AVANT de supprimer la `Demande`/le `Reglement`
  sous-jacents, jamais après.
- `tsc`/`eslint` clean, vrai `next build` réussi (65 routes).

### Traçabilité d'une demande après règlement/clôture

Signalement : une demande réglée + retour réceptionné disparaît (à raison)
des listes "Demandes en attente de validation"/"Retours en attente" — mais
aucun moyen quotidien ne permettait ensuite de la retrouver, en particulier
une fois `CLOTUREE`, où elle semblait avoir complètement disparu.

**Diagnostic fait avant toute correction** :
- **Écran de détail (`treso/finance/demandes/[id]/page.tsx`)** : reste
  bien accessible directement par URL/ID une fois `CLOTUREE` (jamais un
  `notFound()`/crash — la branche `CLOTUREE` a toujours existé), MAIS
  **masquait deux blocs d'information** avant cette tâche : `ReglementsSection`
  (liste des règlements, mode, auteur, dates, liens "Télécharger le
  reçu"/"bon de caisse") n'était tout simplement jamais rendue dans cette
  branche ; et le détail ligne par ligne des dépenses/pièces jointes de
  `RegularisationSummary` (`canGererJustification`, voir "Détail des
  dépenses sur l'écran de Régularisation") restait invisible faute d'être
  transmis. Un règlement réglé-mais-pas-encore-clôturé, lui, affichait déjà
  tout correctement (branche inchangée, jamais concernée par le bug).
- **Écran de reporting (`/treso/finance/reporting`)** : son filtre
  `statut` couvre déjà bien les 11 valeurs de `StatutDemande`, CLOTUREE/
  REGLEE inclus (dérivé de `STATUT_DEMANDE_LABEL`, jamais une liste
  dupliquée). En revanche, ses tableaux sont des **agrégats par Catégorie
  × Objet** (`getReportingRows`), jamais une ligne par demande individuelle
  — rendre une ligne agrégée "cliquable vers le détail" n'a structurellement
  aucun sens (plusieurs dizaines de demandes possibles derrière une seule
  ligne). Le reporting n'a donc PAS été modifié : ce n'est pas l'outil
  pour "retrouver UNE demande précise", et forcer un lien dessus aurait
  été un correctif de façade plutôt qu'une vraie solution.

**Conclusion : les deux (correctif + nouvel écran), pas un choix entre les
deux** — le correctif du détail répare l'information une fois qu'on a
déjà l'ID/la référence ; il manquait toujours un moyen de la RETROUVER
sans la connaître à l'avance, d'où le nouvel écran.

**1. Correctif du détail (`page.tsx`, `RegularisationSummary.tsx`)** :

- Branche `CLOTUREE` : ajoute `<ReglementsSection ... canEffectuerReglement={false} />`
  (si `montantValide > 0`) et passe `showDetail` (nouvelle prop, voir
  ci-dessous) à `RegularisationSummary`. `canEffectuerReglement={false}`
  **inconditionnel** (jamais la permission réelle du lecteur) : une fois
  clôturée, plus AUCUN compte ne peut agir, quel que soit son rôle —
  cohérent avec le bandeau déjà affiché ("plus aucune action n'est
  possible"), jamais une question de permission à ce stade.
- **`RegularisationSummary.tsx`** — `canGererJustification` (action
  "Marquer non justifiée") et `showDetail` (visibilité du détail
  ligne par ligne) sont désormais deux props DISTINCTES (`showDetail`
  défaut = `canGererJustification`, pour ne rien changer à l'appel
  existant côté écran actif) : permet d'afficher le détail en LECTURE
  SEULE (`showDetail` seul) sans jamais proposer une action vouée à
  l'échec côté serveur (`canGererJustification` resterait `false`). Une
  ligne non justifiée sans motif, ni réceptionnée ni gérable, affiche
  désormais "Non justifiée, jamais traitée par Finance." (nouveau texte,
  remplace l'ancien silence — cette branche n'existait pas avant, seule
  `canGererJustification` contrôlait tout le bloc jusqu'ici).

**2. Nouvel écran "Toutes les demandes"** (`/treso/finance/demandes/toutes`,
complément DÉLIBÉRÉ, jamais un remplacement) :

- **`ToutesLesDemandesFiltersForm`/`ToutesLesDemandesTable`** — même
  pattern GET natif que `ReportingFiltersForm`/même pattern `DataTable` +
  lien "Voir le détail" que `DemandesACategoriserTable`. Filtres :
  référence (texte libre, `contains` insensible à la casse), créateur,
  statut — volontairement simple, ce n'est pas un écran d'analyse.
  Aucune pagination (volume toujours modeste, même hypothèse que le reste
  du module).
- **Accès** : `treso.valider_demande` OU `treso.effectuer_reglement` OU
  `treso.receptionner_retour` — couvre Responsable Finance, Assistant
  Finance ET DG, jamais RH ni Collaborateur. Nouveau flag de nav
  `canVoirToutesLesDemandes` (distinct de `canAccesFinanceDemandes`,
  jamais fusionné avec lui) propagé `(dashboard)/layout.tsx` →
  `AppShell.tsx` → `Sidebar.tsx`/`nav.ts`, item `exact: true` (évite qu'il
  s'allume à tort sur `/treso/finance/demandes`, son préfixe strict).
  **Nuance non corrigée, sans rapport avec cette tâche** : visiter cette
  page allume AUSSI "Demandes en attente de validation" dans la sidebar
  (cet item-là n'a pas `exact`) — comportement déjà préexistant pour
  `/treso/finance/demandes/[id]` (le détail), pas quelque chose que cette
  tâche a introduit ni dû corriger (`page.tsx`/`RetoursEnAttenteTable.tsx`
  existants restent intouchés, comme demandé).
- **Jamais de modification des écrans filtrés existants** ("Demandes en
  attente de validation", "Retours en attente") — confirmé par diff vide
  sur `demandes/page.tsx`, `DemandesACategoriserTable.tsx`,
  `retours/page.tsx`, `RetoursEnAttenteTable.tsx`.

**Vérifications, parcours réel (comptes de test, deux demandes créées
pour l'occasion)** :
- Demande réglée + retour réceptionné (jamais clôturée) : absente des
  deux listes filtrées, détail toujours pleinement consultable par
  Finance (déjà correct avant cette tâche, reconfirmé).
- Demande menée jusqu'à `CLOTUREE` (validation → règlement confirmé →
  retour réceptionné → validation complète DG → clôture Finance) :
  détail affiche désormais règlement (montant, mode, auteur, lien "Télécharger
  le reçu"), détail de la dépense déclarée (pièce jointe consultable),
  Personnes intervenantes (Validateur/Régleur/Clôturé par), bandeau de
  clôture et motif — confirmé identique pour un accès Finance ET DG.
- Nouvel écran : les deux demandes de test y apparaissent sans filtre ;
  `?statut=CLOTUREE` isole bien la seconde ; `?reference=...` isole bien
  la première ; les liens "Voir le détail" pointent vers les bons ID.
  Accès confirmé 200 pour Finance/Assistant/DG, redirect confirmé pour
  RH/Collaborateur.
- `tsc`/`eslint` clean, vrai `next build` réussi (66 routes).

**Point découvert pendant la vérification, sans rapport avec cette tâche,
signalé par transparence** : une demande "NOURRITURE DE LA PAUSE"
(référence `DEM-2026-000004`, créée par le compte de test Collaborateur à
10:48 le 2026-09-21, réglée et déjà approuvée par le DG) existait dans la
base de dev partagée sans porter aucun marqueur de donnée de test
(`(à supprimer)` ou équivalent) — elle ne correspond à aucun script créé
par cette session. **Volontairement non touchée** (ni elle, ni son
règlement, ni son retour, ni ses écritures `JournalCaisse`) : pourrait
être un test manuel effectué en parallèle sur cette même base partagée. À
confirmer : s'il s'agit bien d'une donnée de test oubliée, la nettoyer ;
sinon, la laisser suivre son cours normal.

### Budget partagé par Catégorie

Le budget appartient à la **Catégorie** (nature de la dépense), jamais au
demandeur, au bénéficiaire ni à son service — une enveloppe partagée entre
toutes les demandes de cette catégorie.

- **`Categorie.budgetAlloue`** (`Decimal?`) — `null` = aucune limite.
- L'argent est retiré au moment du **règlement**, jamais à la validation :
  une demande peut être validée totalement sans blocage, seule la
  confirmation d'un règlement vérifie le budget.
- **`getBudgetRestantCategorie`** retourne la valeur brute, **jamais
  plafonnée à 0** (un négatif signale un vrai dépassement).
- Contrôle bloquant dans `confirmerReglementAction`, après la vérification
  `montantValide` déjà existante — sans effet si la demande n'a pas de
  `categorieId` ou si sa Catégorie n'a pas de `budgetAlloue`.
- Aucun renouvellement automatique périodique — l'Admin réajuste
  manuellement `budgetAlloue` si besoin.
- Ancien mécanisme (`Demande.budgetDisponible` par demande,
  `Demande.posteBudgetaireId` en étiquette décorative) **retiré
  définitivement**.

**Budget visible au moment de la catégorisation** — l'écran de
catégorisation Finance (`treso/finance/demandes/[id]/CategorisationForm.tsx`)
affiche, dès qu'une Catégorie est sélectionnée dans le Select, un aperçu
(`BudgetCategorieApercu`) : budget alloué / déjà consommé / restant
disponible. Réutilise directement **`getMontantConsommeCategorie`**
(la même fonction que le contrôle bloquant du règlement, jamais recalculée
séparément) — le `restant` est dérivé inline avec la formule identique à
`getBudgetRestantCategorie` (`budgetAlloue - consomme`), sans rappeler
cette dernière : `budgetAlloue` est déjà disponible dans le tableau
`categories` chargé par la page (`page.tsx`), la rappeler aurait
réintroduit une requête redondante pour une valeur déjà en mémoire (voir
"Diagnostic de latence — requêtes redondantes" plus haut). Calculé une
seule fois côté serveur pour **toutes** les catégories proposables
(`Promise.all`), jamais recalculé au changement de Select côté client —
même volume que `categories`/`objets`, déjà chargé une fois par la page.
Purement informatif : aucune action, aucun blocage ici — le contrôle
bloquant réel reste au règlement (`confirmerReglementAction`), une
catégorie déjà en dépassement reste sélectionnable, Finance est seulement
prévenue à l'avance.

**Mise à jour majeure depuis "Catégorisation par ligne"** (voir cette
section plus bas) : `getMontantConsommeCategorie` ne lit plus directement
les règlements — elle lit désormais `ReglementCategorieAllocation`
(allocation budgétaire EXPLICITE, choisie par Finance à chaque règlement,
jamais un calcul implicite dérivé de `Demande.categorieId`). Tous les
principes ci-dessus (décompte au règlement, jamais plafonné à 0, contrôle
bloquant à la confirmation) restent inchangés — seule la SOURCE du calcul
a changé, nécessaire depuis qu'une demande peut avoir plusieurs lignes de
catégories différentes.

### Dashboard Finance — zone « À traiter » (6 indicateurs)

| # | Indicateur | Définition |
|---|---|---|
| 1 | Demandes en attente de validation | `statut ∈ {EN_ATTENTE_VALIDATION, PARTIELLEMENT_VALIDEE}` **et** `reliquatRejete: false` |
| 2 | Montants validés restant à régler | reste à régler > 0, rien réglé encore |
| 3 | Règlements partiels à compléter | reste à régler > 0, déjà réglé en partie |
| 4 | Fonds remis à régulariser | règlements CAISSE confirmés dont le solde à régulariser ≠ 0 (y compris si aucun retour n'a encore été déclaré) |
| 5 | Retours de fonds en attente de réception | retours non réceptionnés d'une demande toujours `VALIDEE`-équivalente |
| 6 | Dépenses non justifiées à suivre | `DepenseLigne` `SANS_PIECE` dont le règlement lié a un solde à régulariser ≠ 0 |

Le solde de caisse (incluant un éventuel solde d'ouverture) reste affiché
en bandeau **distinct**, jamais comme une 7ᵉ carte « à traiter ». Le
DG voit en plus une section séparée « Validation complète (DG) » (nombre
de demandes en attente de son approbation). Les indicateurs 2 et 3 sont
mutuellement exclusifs ; 4/5/6 peuvent se recouper sur un même règlement.
« Décaissements à régulariser » (demandes entièrement réglées, candidates
à la clôture) n'est plus une des 6 cartes mais reste accessible via un
lien secondaire en bas de page.

### Refonte visuelle du dashboard Finance

Refonte **purement esthétique/structurelle** de `/treso/finance` — aucune
nouvelle règle métier, aucune donnée fictive : chaque ajout visuel
réutilise une fonction de calcul déjà existante ailleurs dans le module,
jamais un second calcul divergent. Palette SIM Assurances inchangée
(bleu `#004B9C`/`#51AEE2`, fond clair) ; `StatCard` et le reste de la
coquille applicative (sidebar, header) **non modifiés**, pour ne jamais
faire dériver le style des autres écrans qui réutilisent ces mêmes
composants partagés (dashboard général, "Mon tableau de bord").

- **Courbe d'évolution du solde de caisse** (`SoldeCaisseTrendChart.tsx`,
  posée dans le bandeau "hero" existant, pour le renforcer visuellement
  plutôt que lui ajouter un élément concurrent) — SVG tracé à la main
  (pas de bibliothèque de graphiques, volume de points toujours modeste).
  Données : **`getEvolutionSoldeCaisse(joursMax = 30)`**
  (`dashboardFinance.ts`) — cumul chronologique RÉEL des écritures
  `JournalCaisse` (ordre `createdAt`, jamais `dateOperation` : c'est
  l'ordre d'écriture qui a réellement fait varier le solde), sur les 30
  derniers jours ou depuis la toute première écriture si le grand livre
  est plus jeune. Le dernier point de la courbe est toujours strictement
  égal à `getSoldeCaisse()`. Retourne aussi `depuis` (date de début
  réellement retenue), pour que les autres graphiques de la page décrivent
  EXACTEMENT la même période. Cas vide (moins de 2 points dans la
  fenêtre) : message clair plutôt qu'un graphique trompeur.
- **Donut Caisse/Banque** (`ReglementsModeDonut.tsx`) — répartition des
  règlements confirmés (non annulés) par mode depuis `depuis`
  (**`getRepartitionReglementsParMode`**, groupée sur `confirmeAt`).
  Anneau vide (`EmptyState`) si aucun règlement confirmé sur la période,
  jamais un anneau à 0% trompeur.
- **Barres de budget par Catégorie** (`BudgetCategorieBars.tsx`) — top 5
  catégories actives ayant un budget alloué, triées par montant consommé
  décroissant (**`getTopCategoriesBudget`**, réutilise directement
  `getMontantConsommeCategorie` — la même fonction que le contrôle
  bloquant du règlement et l'aperçu de catégorisation, jamais un second
  calcul). Barre rouge et texte de dépassement si `consomme > budgetAlloue`
  (le montant affiché reste la valeur brute, jamais plafonnée).
- **Icônes ajoutées** : `trending-up`, `pie-chart` (`icons.tsx`), style
  "outline" identique au reste du jeu d'icônes maison.

**Piège React 19 rencontré et corrigé** : un `<title>` SVG par point de la
courbe (infobulle native au survol) provoquait une erreur d'hydratation —
React 19 hisse automatiquement TOUT élément `<title>` vers `<head>` comme
s'il s'agissait du titre du document, sans distinguer le `<title>`
SVG (décoratif) du `<title>` HTML de métadonnées. Confirmé en reproduisant
l'erreur puis en l'éliminant en retirant ces `<title>` — pas de solution
fiable trouvée pour garder une infobulle native SVG dans ce contexte,
omise volontairement plutôt que de rouvrir ce bug. À garder à l'esprit
pour tout futur graphique SVG maison dans le projet.

#### Cartes "À traiter" : `FinanceActionCard.tsx` (dédié, `StatCard` intact)

Suite à un retour utilisateur, les 6 cartes "À traiter" utilisent
désormais **`FinanceActionCard.tsx`** (nouveau, colocalisé avec la page,
utilisé UNIQUEMENT ici) plutôt que `StatCard` — **`StatCard` lui-même
n'est pas modifié**, aucun autre écran (dashboard général, "Mon tableau de
bord" Collaborateur, section "Validation complète (DG)" sur cette même
page) n'est visuellement affecté. Différences volontaires par rapport à
`StatCard` :

- **Badge d'icône teinté par `tone`** (`bg-{tone}-bg`/`text-{tone}`) —
  contrairement à `StatCard`, qui utilise un aplat bleu uniforme sur
  toutes ses icônes (choix délibéré antérieur, documenté dans
  `StatCard.tsx`, non remis en cause).
- **Barre d'accent verticale sur le bord gauche** (`bg-{tone}`), pas la
  barre horizontale en tête de `StatCard`.
- **Survol combinant élévation ET léger changement de teinte de fond**
  (`hover:bg-{tone}-bg`) plutôt que la seule élévation de `StatCard`.

**Piège Tailwind v4 rencontré et corrigé** : `hover:shadow-elevated-lg`
(pattern déjà utilisé par `StatCard`/`Card` dans tout le projet) **ne
génère aucune règle CSS** — `.shadow-elevated`/`.shadow-elevated-lg`
(`globals.css`) sont des classes CSS ordinaires, jamais enregistrées comme
utilitaires Tailwind (ni `@utility`, ni jeton `--shadow-*`) : un préfixe
de variante comme `hover:` ne peut s'appliquer qu'à un utilitaire que
Tailwind reconnaît. **Confirmé en pratique que ce défaut est resté invisible
partout ailleurs jusqu'ici** (l'effet "ombre plus marquée au survol" de
`StatCard`/`Card` n'a probablement jamais fonctionné). Essais qui n'ont
PAS marché non plus, dans l'ordre : valeur arbitraire `hover:shadow-[...]`
(aucune règle générée, deux ombres séparées par une virgule au niveau
racine du crochet) ; `@utility` maison avec `hover:` préfixé (la classe de
base compile, mais son `hover:` reste sans effet, cause non identifiée
avec certitude malgré plusieurs essais, y compris un nom sans rapport avec
la famille `shadow-*` et un vidage complet du cache Turbopack). **Solution
retenue** : une classe CSS ordinaire avec son **propre `:hover` écrit à la
main** (`.card-shadow-hover:hover { box-shadow: ...; }`, `globals.css`),
appliquée SANS préfixe `hover:` (le survol est déjà dans le sélecteur) —
fonctionne de façon fiable, vérifié en pratique (valeur de `box-shadow`
recalculée au survol réel). `.shadow-elevated-lg` reste inchangée (déjà
sans effet en `hover:` partout où elle est utilisée) : la corriger
globalement aurait changé visuellement `StatCard`/`Card` sur tous les
autres écrans, hors périmètre de cette tâche.

#### Cartes "Analyse" cliquables

Les deux cartes de la section "Analyse" redirigent désormais vers l'écran
de reporting existant — **aucun nouvel écran créé**, `Card` (composant
partagé) non modifié : la variante cliquable est construite directement
dans `treso/finance/page.tsx` (un `<Link>` stylé comme `Card` + le même
langage d'interaction que `FinanceActionCard`, élévation + flèche
discrète).

- **Donut "Règlements par mode de paiement"** → `/treso/finance/reporting?du=<depuis>`
  — `depuis` est la date de début RÉELLE de la fenêtre du donut/de la
  courbe (`getEvolutionSoldeCaisse`), reprise telle quelle. Le reporting
  supporte déjà un filtre de période en GET (`du`/`au`,
  `parseReportingFilters`) : aucun nouveau paramètre ajouté côté
  reporting, vérifié avant d'écrire ce lien.
- **Barres "Suivi budgétaire — catégories les plus consommées"** →
  `/treso/finance/reporting#suivi-budgetaire` — `/treso/finance/categories`
  (écran de gestion des Catégories ouvert à Finance) a été explicitement
  écarté : cet écran, pour un utilisateur Finance non-Admin, ne montre
  JAMAIS le budget partagé ni sa consommation (limité à créer/supprimer,
  voir "Gestion des Catégories/Objets ouverte à Finance") — la section
  "Suivi budgétaire" du reporting (déjà existante, `getReportingSuiviBudgetaire`,
  **toutes** les catégories avec budget, pas seulement le top 5 du
  dashboard) est le seul écran qui montre réellement "le détail complet du
  budget par catégorie" demandé. Ancre `id="suivi-budgetaire"` ajoutée sur
  cette section (seul changement apporté à `reporting/page.tsx`).

### Reporting et export

`backend/src/reporting.ts` / `treso/finance/reporting/page.tsx` / export
Excel (**12 feuilles** : Demandes, Validations, Règlements, Retours de
caisse, Fonds remis, Régularisations, Dépenses effectuées, Dépenses non
justifiées, Journal de caisse, Reporting, Suivi budgétaire, Dashboard).

Colonnes du tableau agrégé (par Catégorie puis Objet) :

| Colonne | Formule |
|---|---|
| Demandé | somme de tous les montants, tout statut confondu (y compris `REJETEE`) |
| Validé | somme de `Demande.montantValide` |
| Restant à valider | `max(0, Demandé − Validé)` |
| Réglé / Réglé Caisse / Réglé Banque | règlements confirmés non annulés, ventilés par mode |
| Validé restant à régler | `max(0, Validé − Réglé)` |

**« Fonds remis » (seul) désigne toujours un montant strictement Caisse**
(feuille/section dédiées, `mode: "CAISSE"` explicite) — à ne jamais
confondre avec **« Fonds remis (Caisse + Banque) »**, libellé spécifique à
`RegularisationSummary`/`ARegulariserTable` où le montant (`getTotalRegle`)
agrège les deux modes. Tout nouvel écran doit choisir le bon libellé selon
la fonction de calcul utilisée.

Libellés utilisateur actuels (écran/PDF/Excel — noms de champs Prisma
inchangés) : « Écart » → **Solde à régulariser**, « Dépense déclarée » →
**Dépense effectuée**, « Montant décaissé » → **Fonds remis**.

Filtres disponibles : période, demandeur, **bénéficiaire** (distinct du
demandeur), service, catégorie/objet, mode, statut, type de demande.

### Solde d'ouverture de caisse

`getSoldeCaisse()` reste toujours le seul calcul du solde (jamais modifié
lui-même) ; le solde d'ouverture est une écriture `JournalCaisse` ordinaire
(`type: ENTREE`, `demandeId: null` — ce champ est nullable pour permettre
ce cas). Réservé à `isAdmin() || treso.effectuer_reglement` (jamais le DG
seul).

- **`definirSoldeOuvertureAction`** — une seule fois (refusée si une
  écriture `solde_ouverture` existe déjà).
- **`corrigerSoldeOuvertureAction`** (motif obligatoire) — crée une
  écriture compensatoire (`SORTIE` du montant actuel) puis une nouvelle
  écriture (`ENTREE` du montant corrigé) ; l'écriture d'origine n'est
  jamais modifiée.
- **Pièce jointe justificative obligatoire** sur les deux actions
  (`PieceJointe.journalCaisseId`), revérifiée côté serveur avant toute
  écriture. Historique complet (définitions + corrections, chacune avec sa
  pièce jointe) affiché sur `/treso/finance/solde-ouverture`, reconstruit
  depuis le grand livre lui-même, jamais depuis un champ dédié.

### Nouvelle alimentation de caisse

Apport d'argent physique en caisse en cours d'exploitation — même écran
(`/treso/finance/solde-ouverture`), même rigueur de traçabilité que le
solde d'ouverture, mais un cycle **indépendant et répétable** (jamais
plafonné à une seule occurrence, contrairement au solde d'ouverture).
Bouton "Nouvelle alimentation de caisse" à côté de "Corriger le solde
d'ouverture" (`SoldeOuvertureCorrection.tsx`) — n'apparaît donc, comme lui,
qu'une fois un solde d'ouverture déjà défini (cas réel du portail en
production ; jamais bloquant en pratique).

- **`alimenterCaisseAction(montant, dateOperation, pieceJointeUrl, motif?)`**
  (`treso/finance/solde-ouverture/actions.ts`) — même garde que le solde
  d'ouverture (`isAdmin() || treso.effectuer_reglement`). Crée une écriture
  `JournalCaisse` ordinaire (`type: ENTREE`, `source:
  ALIMENTATION_CAISSE_SOURCE = "alimentation_caisse"`, `demandeId: null`) —
  `getSoldeCaisse()` n'a besoin d'aucune modification.
- **Pièce jointe obligatoire**, revérifiée côté serveur (jamais uniquement
  le bouton désactivé côté client) — même principe que le solde
  d'ouverture. Motif optionnel (contrairement à la correction du solde
  d'ouverture : une alimentation n'est pas la rectification d'une erreur).
- **`JournalCaisse.dateOperation`** (`DateTime?`, nouvelle colonne,
  migration `20260914073432_journal_caisse_date_operation`) — date RÉELLE
  de l'alimentation, potentiellement antérieure à sa saisie dans le portail
  (`createdAt`). `null` pour toutes les autres sources (règlement, retour,
  solde d'ouverture), où `createdAt` fait foi.
- **`getAlimentationsCaisseHistorique()`** — historique dédié, la plus
  récente en premier (inverse de l'historique du solde d'ouverture,
  chronologique croissant : une alimentation est un évènement répétable,
  seules les dernières occurrences intéressent Finance au quotidien).
  Affiché sur la même page, sous l'historique du solde d'ouverture
  (`AlimentationsCaisseHistorique.tsx`).
- Réutilise `PieceJointeUpload`/`POST /api/treso/pieces-jointes/upload`
  (aucune route d'upload dédiée créée).

### Pièce jointe (fonctionnelle)

Stockage disque local `./uploads/` (racine du projet, `process.cwd()` —
correspond au volume Docker nommé `uploads`). `POST
/api/treso/pieces-jointes/upload` : nom de fichier entièrement régénéré
(`randomUUID`), 10 Mo max, PDF/JPG/PNG uniquement. `GET
/api/treso/pieces-jointes/[id]` : Finance/DG, le créateur, ou le
bénéficiaire de la demande liée. Une `PieceJointe` peut être rattachée à
une `Demande`, une `DepenseLigne`, ou une écriture `JournalCaisse` (solde
d'ouverture) — jamais plusieurs à la fois. Présente sur les 3 formulaires
de création (demande standard, dépense directe, ligne de retour de caisse)
et sur le solde d'ouverture.

### Formulaire de demande (« Demande d'Achat »)

Ordre du formulaire, volontairement le "Tableau des articles" d'abord :
tableau de `LigneDemande` (libellé, quantité, prix unitaire) — première
chose remplie —, puis l'en-tête (bénéficiaire, date de livraison
souhaitée, devise, motif). `Demande.montant` = somme calculée des lignes,
jamais saisie directement.

**Aucune Catégorie d'achat sur ce formulaire.** `Demande.categorieId` est
toujours `null` à la création par le collaborateur — la catégorisation
reste entièrement un travail de Finance après création
(`CategorisationForm`, `/treso/finance/demandes/[id]`, déjà conçu pour une
demande non catégorisée, comme pour une dépense directe). Retiré du Select
d'en-tête, du zod de `creerDemandeAction` et de l'écriture Prisma — ne pas
le réintroduire côté collaborateur sans décision explicite contraire.

**Motif de l'achat** — `Textarea` élargie (`rows={7}`, contre 4
auparavant) avec un placeholder invitant à préciser contexte/usage/urgence
— même champ (`Demande.description`), pas un champ séparé.

**Prix unitaire** — `LigneEdit.prixUnitaire` est une **chaîne**, pas un
nombre (`""` par défaut, jamais `"0"`) : un état initial numérique à `0`
aurait affiché "0" dans le champ, obligeant à le sélectionner/effacer
avant de taper un vrai montant (et risquant un "012000" résiduel sinon).
Placeholder `"0"` à titre indicatif ; converti en nombre
(`Number(...) || 0`) uniquement au calcul du total et à l'envoi à
`creerDemandeAction`. Le champ "Nombre" (quantité) n'a pas ce problème
(défaut `1`, jamais retouché).

`Demande.devise` (défaut `XOF`) n'est **pas encore propagée** aux écrans
Finance ni aux deux PDF (toujours « FCFA » en dur) — sans conséquence tant
qu'aucune demande n'utilise une autre devise.

Mapping bénéficiaire à la création : Collaborateur/Stagiaire → créateur
connecté ; SIM Assurances CI → nom libre pré-rempli ; Fournisseur/prestataire
→ pas encore de champ de nom dédié.

### Validation ligne par ligne

Pour toute demande ayant **au moins une ligne** (`Demande.lignes.length > 0`
— en pratique toute demande `STANDARD`, qui exige `.min(1)` ligne à la
création), **`validerLignesAction` est l'UNIQUE mécanisme de décision** :
elle remplace entièrement `validerTotalementAction`/
`validerPartiellementAction`/`validerComplementaireAction`/
`rejeterReliquatAction` pour ce cas — aucune notion de "reliquat" ne
survit, puisque toutes les lignes sont décidées en un seul geste. Pour une
demande **sans ligne** (`DEPENSE_DIRECTE`, qui n'en crée jamais), ces
quatre actions restent utilisées exactement comme avant, sans aucun
changement de comportement pour ce cas.

**Décision confirmée sur le périmètre choisi** (Option A2 du diagnostic
initial : décision unique et complète, jamais de reliquat par ligne
laissé en suspens ; Option B1 : les quatre anciennes actions restent
réservées aux demandes sans ligne) — les deux avaient été proposées avec
leurs alternatives puis explicitement confirmées avant toute
implémentation.

#### Schéma

- **`StatutLigneDemande`** (`EN_ATTENTE`/`VALIDEE`/`REJETEE`,
  migration `20260921160827_validation_ligne_par_ligne`) — nouveau champ
  `LigneDemande.statutValidation`, `EN_ATTENTE` par défaut, posé **une
  seule fois** (aucune fonction de "dévalidation", même principe
  qu'ailleurs dans le module).
- **`LigneDemande.motifRejet`** — obligatoire (3 caractères minimum,
  revérifié côté serveur) si `statutValidation = REJETEE`, sinon toujours
  `null`.
- **`LigneDemande.decideParId`/`decidePar`/`decideAt`** — auteur et date
  de la décision (validée OU rejetée), `null` tant qu'`EN_ATTENTE`.
- **`LigneDemande.libelleOriginal`** — même mécanique exacte que
  `Demande.descriptionOriginale` : `null` tant que `libelle` n'a jamais
  été modifié depuis la création, renseignée **une seule fois** à la
  première modification par Finance, jamais réécrite ensuite. Le
  Collaborateur créateur voit toujours `libelleOriginal ?? libelle`,
  jamais la version modifiée.
- Migration purement additive, aucune donnée de rattrapage (fonctionnalité
  développée et vérifiée en local avant toute mise en production, base de
  test vidée avant bascule réelle).

#### Server Actions (`treso/finance/demandes/[id]/actions.ts`)

- **`validerLignesAction(demandeId, decisions[])`** — une seule
  transaction : vérifie que la demande a au moins une ligne et est
  `EN_ATTENTE_VALIDATION` ; vérifie qu'**aucune** ligne n'est déjà décidée
  (voir le piège ci-dessous) ; vérifie que **toutes** les lignes de la
  demande sont couvertes par les décisions reçues, ni plus ni moins
  (refuse un id manquant, en trop, ou étranger à la demande) ; motif
  obligatoire pour chaque ligne `REJETEE` ; recalcule
  `Demande.montantValide` = Σ (quantite × prixUnitaire) des seules lignes
  `VALIDEE` ; appelle `calculerStatutDemande()` **sans aucune
  modification** de cette fonction ; une `HistoriqueEntry` par ligne
  décidée (`entity: "LigneDemande"`, `entityId: <ligneId>`, action
  `validation_ligne`/`rejet_ligne`).

  **Piège trouvé et corrigé pendant l'implémentation, avant toute mise en
  service** : `demande.statut !== "EN_ATTENTE_VALIDATION"` seul ne suffit
  PAS comme garde contre une seconde exécution. Si **toutes** les lignes
  sont rejetées, `montantValide` retombe à 0 et `calculerStatutDemande`
  (jamais modifiée) repasse la demande en `EN_ATTENTE_VALIDATION` — alors
  que ses lignes sont pourtant déjà toutes décidées. Sans un second
  contrôle explicite (`demande.lignes.some(l => l.statutValidation !==
  "EN_ATTENTE")` → refus), ce cas précis aurait permis à Finance de
  relancer une seconde décision sur les mêmes lignes, une forme de
  dévalidation par la bande contraire au principe "décision unique et
  complète". **Reproduit et vérifié en pratique** (demande de test à 2
  lignes, les deux rejetées → statut revenu à `EN_ATTENTE_VALIDATION`,
  `montantValide: 0`, nouvelle tentative de décision refusée avec
  "Les lignes de cette demande ont déjà été décidées.").

  **Permission : réservée au Responsable Finance UNIQUEMENT**
  (`treso.valider_demande` ET PAS `treso.approuver_validation_complete`)
  — **jamais** l'Assistant Finance, contrairement à
  `modifierLibelleLigneAction` ci-dessous. Décision confirmée après
  consultation explicite (le diagnostic initial recommandait ce choix sans
  trancher seul) : c'est une décision de VALIDATION, et l'Assistant
  Finance n'a, dans tout le reste du module, jamais aucun pouvoir de
  décision — seulement `effectuer_reglement`/`receptionner_retour`, des
  actions d'EXÉCUTION une fois la décision déjà prise par le Responsable
  (voir "Séparation stricte Responsable Finance / Assistant Finance").
  Vérifié en pratique par rejeu réseau direct : le DG (qui porte aussi
  `treso.valider_demande`) et l'Assistant Finance sont tous deux refusés.

- **`modifierLibelleLigneAction(ligneId, nouveauLibelle)`** — même pattern
  exact que `modifierDescriptionAction` (mécanique `libelleOriginal`,
  verrou `CLOTUREE` uniquement, `HistoriqueEntry` action
  `modification_libelle_ligne`). Permission **volontairement plus large**
  que la décision elle-même : `(treso.valider_demande` ET PAS
  `approuver_validation_complete) OU treso.effectuer_reglement` —
  Responsable ET Assistant Finance, jamais le DG. Modifier un libellé
  n'est jamais une décision de validation, reste donc ouvert à
  l'Assistant comme la description de la demande elle-même. Vérifié en
  pratique : l'Assistant Finance modifie un libellé avec succès, le DG
  est refusé.

- **Garde ajoutée sur les quatre anciennes actions**
  (`validerTotalementAction`/`validerPartiellementAction`/
  `validerComplementaireAction`/`rejeterReliquatAction`) : refus explicite
  dès que la demande a au moins une ligne ("Cette demande contient des
  lignes d'article : utilisez la validation ligne par ligne."), via un
  `prisma.ligneDemande.count()` ajouté en tête de chacune. Vérifié en
  pratique sur une demande à lignes (refusé) et sur la `DEPENSE_DIRECTE`
  existante (0 ligne, comportement métier préexistant inchangé —
  `validerComplementaireAction`/`rejeterReliquatAction` refusées pour
  leur raison habituelle, "reliquat déjà rejeté", jamais pour la nouvelle
  garde).

  **Point non tranché unilatéralement, signalé plutôt que décidé** :
  `rejeterDemandeAction` (rejet total AVANT toute validation) n'a
  volontairement **pas** reçu cette garde — la consigne énumérait
  explicitement les quatre actions ci-dessus, sans la mentionner. Une
  demande avec lignes reste donc, à ce stade, rejetable intégralement via
  cette action sans qu'aucune ligne ne soit individuellement décidée
  (`statutValidation` de chaque ligne resterait `EN_ATTENTE` malgré un
  statut de demande `REJETEE`) — incohérence potentielle mineure, à
  trancher explicitement si elle pose problème en pratique.

#### Interface Finance (`treso/finance/demandes/[id]`)

**`LignesValidationTable.tsx`** (nouveau, colocalisé) remplace
`ValidationActions`/le bloc reliquat dès que `demande.lignes.length > 0`,
sur toutes les branches de rendu concernées (`EN_ATTENTE_VALIDATION`,
`montantValide > 0`, et `CLOTUREE` en lecture seule pour la traçabilité) —
jamais les deux affichés à la fois pour une même demande. Détermine
lui-même son mode (interactif vs lecture seule) à partir du
`statutValidation` de chaque ligne, **jamais** de `demande.statut` seul
(voir le piège ci-dessus) :

- **Mode interactif** (au moins une ligne `EN_ATTENTE`) : par ligne,
  libellé (avec lien "Modifier" ouvrant un champ inline, même pattern
  visuel que `DescriptionEditor`, versions initiale/modifiée affichées en
  permanence dès qu'elles divergent), quantité, prix unitaire, total,
  deux boutons Valider/Rejeter (bascule de variante `Button`, pas de
  composant radio dédié dans le design system), champ motif apparaissant
  uniquement si "Rejeter" est choisi. Total "Montant qui sera validé"
  recalculé en direct côté client. Bouton unique "Enregistrer les
  décisions", désactivé tant que toutes les lignes n'ont pas de décision
  et que tous les motifs de rejet ne sont pas remplis (min 3 caractères) —
  revérifié de toute façon côté serveur.
- **Mode lecture seule** (toutes les lignes déjà décidées) : même tableau,
  badge de statut (`STATUT_LIGNE_DEMANDE_BADGE_VARIANT`, mêmes tokens
  sémantiques que `STATUT_DEMANDE_BADGE_VARIANT`) + motif si rejetée +
  auteur/date de la décision, aucun contrôle d'action. Le libellé reste
  modifiable indépendamment de l'état de décision (même verrou `CLOTUREE`
  que partout ailleurs) — modifier un libellé n'est jamais lié à la
  décision de validation elle-même.

#### Interface Collaborateur (`treso/demandes/[id]`)

Le "Tableau des articles" existant affiche désormais, par ligne, un badge
de statut (mêmes tokens que ci-dessus) et le motif en petit texte si
rejetée. **Le libellé affiché est toujours `ligne.libelleOriginal ??
ligne.libelle`** — jamais la version modifiée par Finance, même principe
que `Demande.descriptionOriginale`.

#### Historique (`DemandeHistorique.tsx`)

Les entrées `validation_ligne`/`rejet_ligne`/`modification_libelle_ligne`
portent `entity: "LigneDemande"` et `entityId: <ligneId>`, jamais
`entityId: demandeId` — le composant charge d'abord les lignes de la
demande pour les inclure dans le même historique fusionné (`OR` sur deux
familles d'entité). `modification_libelle_ligne` rejoint
`ACTIONS_GESTION_INTERNE` (même traitement que
`modification_description` : révèle l'ancien libellé, jamais montré au
Collaborateur). **`validation_ligne`/`rejet_ligne` restent volontairement
visibles** au Collaborateur, contrairement au reste de cette liste : la
Tâche 4 lui montre déjà directement, sur le tableau des articles, le
statut de décision de chaque ligne — les masquer dans l'historique créerait
une incohérence avec ce qu'il voit déjà par ailleurs.

#### Vérifications, parcours réel (comptes de test réels, rejeu réseau direct)

- Demande de test à 3 lignes : Finance valide 2 lignes et rejette la 3ᵉ
  avec motif → `montantValide` exactement égal à la somme des 2 lignes
  validées, statut `PARTIELLEMENT_VALIDEE`, 3 `HistoriqueEntry`
  (`entity: "LigneDemande"`) créées avec le bon `action`/`detail`.
- Rejet sans motif → refusé, testé par rejeu réseau direct (contournement
  du formulaire).
- Décisions incomplètes (une ligne non couverte) → refusée
  ("Toutes les lignes de la demande doivent être décidées...").
- Nouvelle tentative de décision sur des lignes déjà décidées → refusée
  ("Les lignes de cette demande ont déjà été décidées"), y compris dans
  le cas piège où le statut de la demande était revenu à
  `EN_ATTENTE_VALIDATION` (voir plus haut).
- DG et Assistant Finance refusés sur `validerLignesAction` (rejeu réseau
  direct) ; Assistant Finance autorisé sur `modifierLibelleLigneAction`,
  DG refusé.
- Collaborateur : badges corrects (y compris sur la demande où toutes les
  lignes ont été rejetées), motif affiché, libellé toujours original même
  après modification par Finance (0 occurrence de la version modifiée
  dans la page rendue), `modification_libelle_ligne` absente de son
  historique alors qu'elle apparaît dans celui de Finance.
- `DEPENSE_DIRECTE` existante (0 ligne) : `validerComplementaireAction`/
  `rejeterReliquatAction` refusées pour leur raison métier préexistante
  (reliquat déjà rejeté), jamais pour la nouvelle garde — confirme que le
  comportement des demandes sans ligne est resté inchangé.
- Un règlement (mode Banque) créé et confirmé sur la demande partiellement
  validée par lignes fonctionne normalement (`peutEffectuerReglement`/
  `getResteARegler` lisent `montantValide`, jamais les lignes
  directement) ; reçu PDF généré avec succès. Dashboard Finance,
  reporting, export Excel (12 feuilles) et écran "À décaisser" tous
  vérifiés fonctionnels sans aucune modification de leur code.
- Nettoyage complet après vérification : demandes de test, leurs lignes,
  `HistoriqueEntry` et l'unique règlement (mode Banque, donc zéro écriture
  `JournalCaisse` à annuler) supprimés ; solde de caisse revérifié
  identique avant/après (4 490 000 FCFA) ; base revenue à ses 7 demandes
  d'origine. Route de diagnostic temporaire et scripts `scratch-*.ts`
  supprimés après usage.
- `tsc --noEmit` et `next build` (66 routes) passent sans erreur avant
  nettoyage ; `next build` revérifié après nettoyage (65 routes, la route
  de diagnostic disparue).

**Piège d'environnement rencontré et corrigé, sans lien avec le code
métier** : le serveur `next dev` déjà en cours d'exécution pour cette
session avait chargé le Prisma Client généré **avant** la migration de
cette tâche (le singleton `globalForPrisma.prisma`, conservé sur
`globalThis` pour survivre au hot-reload, ne réimporte pas spontanément
un client Prisma régénéré sur disque) — les nouveaux champs de
`LigneDemande` étaient silencieusement absents des résultats de requête
malgré une base de données à jour, provoquant un faux positif ("lignes
déjà décidées" sur des lignes réellement `EN_ATTENTE`). Diagnostiqué par
une route de debug dédiée comparant la lecture Prisma vue par le serveur
et une lecture directe en script ; corrigé par un redémarrage du serveur
de dev (aucune conséquence en production, où `next build`/`next start`
repartent toujours d'un process neuf après `prisma generate`).

#### Bug signalé — "l'interaction se bloque après avoir cliqué Rejeter"

Signalement : sur `LignesValidationTable.tsx`, cliquer "Rejeter" affiche
bien le champ motif, mais ensuite "l'interaction se bloque" (saisir le
motif, ou "Enregistrer les décisions" semble ne plus réagir) — alors que
"Valider" sur toutes les lignes fonctionne normalement.

**Diagnostic fait avec une vraie interaction navigateur, pas seulement une
relecture de code** (voir méthodologie ci-dessous) : l'état React et la
logique de décision (`decisions`, `toutesDecidees`, `motifsValides`,
`peutEnregistrer`) se sont révélés **corrects** — taper un motif, y
compris caractère par caractère à vitesse réelle, met bien à jour la
valeur du champ, recalcule bien "Montant qui sera validé" en direct, et
active bien "Enregistrer les décisions" dès que toutes les lignes ont une
décision valide. **Cause réelle trouvée** : une fois qu'au moins une ligne
est "Rejeter" avec un motif de MOINS de 3 caractères, le bouton reste
CORRECTEMENT désactivé (comportement voulu) — mais **rien sur l'écran
n'expliquait pourquoi** : aucun message d'erreur sur le champ motif,
aucune indication près du bouton. Un test avec un motif volontairement
court ("na", 2 caractères) reproduit exactement la perception de blocage
signalée, sans qu'aucune ligne de code ne soit réellement en tort — un
défaut d'ergonomie (absence de retour), pas un bug de logique.

**Corrigé** (`LignesValidationTable.tsx`) : le champ motif reçoit
désormais une erreur inline ("3 caractères minimum.", même prop `error`
que partout ailleurs dans le design system) dès qu'il est non vide mais
trop court ; un message explicatif apparaît aussi juste au-dessus du
bouton "Enregistrer les décisions" tant qu'il reste désactivé pour une
raison de complétude (`raisonBlocage` : "Chaque ligne doit avoir une
décision..." ou "Un motif de rejet d'au moins 3 caractères est
requis..."), même principe que le message de permission
("Votre rôle ne permet pas...") déjà présent juste à côté.

**Méthodologie de diagnostic** (aucun outil de navigateur/test visuel
n'existait jusqu'ici dans ce projet — voir les nombreuses mentions
"aucune capture d'écran... outil non disponible dans cet environnement"
ailleurs dans ce document) : `vitest` + `@testing-library/react` +
`jsdom` installés **temporairement** (`npm install --no-save`, jamais
ajoutés à `package.json`) pour un premier test d'interaction isolé
(frappe clavier réelle simulée sur le composant seul, zéro erreur trouvée)
— insuffisant pour conclure avec certitude sur un bug qui pourrait être
spécifique à Next.js/au navigateur réel. **`playwright` installé de la
même façon** (chromium déjà partiellement en cache sur la machine,
complété par téléchargement), pour piloter un **vrai Chromium headless**
contre le VRAI serveur `next dev` déjà lancé, avec de vraies sessions
authentifiées (Collaborateur crée une demande à plusieurs lignes via le
vrai formulaire, Finance ouvre l'écran réel, clique réellement sur les
boutons, tape réellement au clavier) — plusieurs scénarios rejoués
(ordre Rejeter d'abord/Valider d'abord, motif à exactement 3 caractères,
frappe sans délai, 3 lignes avec décisions mixtes), avec capture de la
console navigateur (`page.on("console")`/`page.on("pageerror")`) à
chaque étape. Tous les devDependencies et scripts de test ont été
supprimés après usage (jamais ajoutés à `package.json`/au lockfile,
`npm uninstall --no-save` de retour à l'identique) — même rigueur que les
scripts `scratch-*.ts` déjà utilisés côté backend.

**Point non lié à cette tâche, observé et non corrigé** : un avertissement
d'hydratation React (`style={{caret-color:"transparent"}}` sur le champ
cache `demandeId` de `CategorisationForm.tsx`) est apparu de façon
intermittente pendant les tests navigateur — jamais bloquant (les
scénarios aboutissaient malgré tout), non reproductible de façon fiable,
et sans rapport avec `LignesValidationTable`. Signalé par transparence,
non creusé davantage (hors périmètre de cette tâche).

**Donnée réelle trouvée dans la base de dev partagée pendant la
vérification, non touchée** : une demande "DEPENSE GROUPE" (référence
attribuée automatiquement lors de la vérification, 4 lignes, catégorisée,
intégralement validée) portait un horodatage du jour même de cette tâche
— vraisemblablement le propre test manuel de l'utilisateur avant de
signaler ce bug. Laissée telle quelle (pas une donnée créée par les
scripts de cette tâche), conformément au principe "ne jamais supprimer
une donnée non reconnue sans clarification".

#### Bug trouvé et corrigé — demande à lignes mixtes bloquée définitivement dans "Demandes en attente"

Signalement : `DEM-2026-000009` (2 lignes, l'une validée à 12 000 FCFA,
l'autre rejetée) restait visible dans "Demandes en attente de validation"
sans plus aucune action possible dessus, ni validation ni clôture, alors
même que son montant validé était déjà intégralement réglé et régularisé
(règlement Caisse confirmé, retour réceptionné, solde à régulariser à 0).

**Diagnostic fait en base ET en pratique (compte Finance réel), pas
supposé** :
- Ses 2 `LigneDemande` étaient déjà TOUTES décidées
  (`statutValidation`: `VALIDEE`/`REJETEE`, `decideAt` renseignée) —
  `validerLignesAction` avait donc déjà fait son travail correctement,
  `montantValide` (12 000) correspondant exactement à la somme des lignes
  `VALIDEE`. Aucune donnée incohérente : c'est un vrai bug de code, pas
  une donnée de test à corriger.
- `demande.statut = "PARTIELLEMENT_VALIDEE"` (cohérent :
  `montantValide < montant`, `calculerStatutDemande` jamais modifiée).
- **Cause exacte** : `DEMANDES_EN_ATTENTE_VALIDATION_WHERE` (`tresorerie.ts`,
  utilisée par `/treso/finance/demandes` ET le compteur du dashboard)
  traite `PARTIELLEMENT_VALIDEE` comme "il reste toujours une décision à
  prendre" — vrai pour l'ANCIEN modèle par montant global (reliquat), FAUX
  pour une demande AVEC lignes une fois que `validerLignesAction` les a
  TOUTES décidées en un seul geste (jamais de reliquat par ligne, jamais de
  dévalidation, voir "Validation ligne par ligne" ci-dessus) : le
  caractère partiel devient alors définitif, exactement comme un reliquat
  explicitement rejeté (`reliquatRejete`, déjà exclu par ce même filtre)
  — mais ce deuxième cas n'avait jamais été couvert lors de l'introduction
  de la validation ligne par ligne.
- **Même bug, deuxième symptôme** : `STATUTS_VALIDATION_COMPLETE` (gate de
  `cloturerDemandeAction` ET de l'affichage de la section "Clôture" sur
  `treso/finance/demandes/[id]/page.tsx`) ne contient que les statuts
  atteignables quand `montantValide === montant` — jamais
  `PARTIELLEMENT_VALIDEE`. Une demande à lignes mixtes ne pouvait donc
  JAMAIS être clôturée, quel que soit l'avancement réel de son règlement.
  Reproduit en pratique : 0 bouton "Valider" et 0 bouton "Clôturer" sur
  l'écran de détail, alors que Règlement/Régularisation affichaient déjà
  "Reste à régler : 0 FCFA"/"Solde à régulariser : 0 FCFA".

**Corrigé** (`backend/src/tresorerie.ts`, nouvelle fonction
`lignesToutesDecidees(lignes)` — `true` si la demande a des lignes ET
qu'aucune n'est plus `EN_ATTENTE`, équivalent pour le modèle "ligne par
ligne" de `STATUTS_VALIDATION_COMPLETE` pour l'ancien modèle) :
- `DEMANDES_EN_ATTENTE_VALIDATION_WHERE` restructurée en `OR` : une
  demande SANS ligne suit l'ancienne règle inchangée ; une demande AVEC
  lignes ne compte comme "en attente" que si AU MOINS une ligne est
  encore `EN_ATTENTE` — couvre aussi, par construction, le cas où TOUTES
  les lignes seraient rejetées (`montantValide = 0`, `statut` retombant à
  `EN_ATTENTE_VALIDATION` — piège déjà documenté dans "Validation ligne
  par ligne").
- `cloturerDemandeAction` (`treso/finance/demandes/[id]/actions.ts`) et
  la condition d'affichage de la section "Clôture" sur `page.tsx` :
  `STATUTS_VALIDATION_COMPLETE.includes(demande.statut) ||
  lignesToutesDecidees(demande.lignes)` — une seule condition ajoutée aux
  deux endroits, jamais dupliquée sous une forme divergente.
- **Point signalé, volontairement NON traité (hors périmètre du
  signalement)** : le cas symétrique "TOUTES les lignes rejetées" (statut
  reste `EN_ATTENTE_VALIDATION`, `montantValide = 0`) sort désormais
  correctement de "Demandes en attente de validation" grâce au fix
  ci-dessus, mais reste volontairement **non rendu clôturable** — aucune
  demande de test dans cet état n'existe actuellement (voir vérification
  ci-dessous), et la question "une demande où rien n'a été validé
  doit-elle être clôturée, ou plutôt migrer vers `REJETEE`, l'état
  terminal déjà utilisé pour un rejet total ?" est une vraie décision
  produit distincte, jamais tranchée seule ici.

**Vérifications, parcours réel (comptes de test réels, jusqu'à la
clôture effective)** :
- `DEM-2026-000009` confirmée absente de "Demandes en attente de
  validation" après le correctif (recoupé aussi directement contre
  `DEMANDES_EN_ATTENTE_VALIDATION_WHERE`, requête vide).
- Bouton de clôture toujours invisible tant que le DG n'avait pas
  approuvé (comportement inchangé, verrou indépendant) ; DG approuve la
  validation complète via l'écran réel → `validationCompleteParDG: true`
  confirmé en base, statut de la demande inchangé (déverrouillage
  seulement, comme documenté dans "Vérification de la règle de clôture à
  double validation").
- "Clôturer totalement"/"Clôturer partiellement" apparaissent alors sur
  l'écran Finance → clôture totale confirmée via le vrai parcours
  (bouton → confirmation) → `statut: CLOTUREE` vérifié en base. La
  demande progresse désormais normalement, jusqu'à son terme réel.
- **Sanity check inverse** : une demande fraîchement créée avec une ligne
  encore `EN_ATTENTE` (aucune décision) continue d'apparaître dans le
  filtre — le correctif n'exclut que les demandes dont TOUTES les lignes
  sont décidées, jamais les demandes réellement en attente.
- Scan exhaustif de toutes les demandes à lignes de la base de dev
  partagée (9 au total) : `DEM-2026-000009` était la SEULE dans cet état
  incohérent — aucune autre demande de test à corriger.
- `tsc --noEmit`, `eslint` et `next build` (66 routes) passent sans
  erreur.

### Catégorisation par ligne + allocation budgétaire explicite par règlement

Besoin : une demande à plusieurs lignes (ex: "Transport" et "Matériel")
doit pouvoir recevoir une Catégorie/Objet **différente par ligne** — avant
cette tâche, une seule catégorisation s'appliquait à toute la demande,
empêchant de distinguer les natures de dépense d'une même demande. Même
découpage que "Validation ligne par ligne" : `DEPENSE_DIRECTE` (0 ligne)
garde sa catégorisation au niveau de la demande, inchangée ; `STANDARD`
(≥1 ligne) passe à une catégorisation par ligne.

**Option 2 du diagnostic préalable retenue pour le budget : allocation
EXPLICITE, jamais un apportionnement proportionnel calculé.** Chaque
Catégorie garde un budget strictement indépendant ; un règlement touchant
plusieurs catégories exige que Finance répartisse elle-même, explicitement,
le montant entre elles.

#### Schéma

- **`LigneDemande.categorieId`/`objetId`** (nullables, mêmes relations que
  sur `Demande`) — modifiables UNIQUEMENT tant que
  `ligne.statutValidation === "EN_ATTENTE"` (`categoriserLigneAction`
  refuse sinon) : relit la règle impérative "Catégorie/objet modifiables
  uniquement avant validation" à l'échelle de la LIGNE, pas de la demande
  entière. `Demande.categorieId`/`objetId` restent, eux, l'unique
  mécanisme pour `DEPENSE_DIRECTE` (jamais renseignés pour une
  `STANDARD` désormais).
- **`ReglementCategorieAllocation`** (`{ id, reglementId, categorieId,
  montant }`, `@@unique([reglementId, categorieId])`) — une ligne par
  Catégorie concernée par un règlement. **Toujours au moins une
  allocation** dès qu'un règlement porte sur une demande catégorisée
  (même une seule catégorie en crée une, à 100%, de façon transparente) ;
  la somme des `montant` de ses allocations égale TOUJOURS exactement
  `Reglement.montant`, revérifié côté serveur à chaque écriture. Migration
  purement additive (`20260922104612_categorisation_par_ligne_allocation_budgetaire`),
  aucune donnée de rattrapage (développée et vérifiée en local, base de
  test vidée avant bascule réelle).

#### Server Actions

- **`categoriserLigneAction(ligneId, categorieId, objetId)`**
  (`treso/finance/demandes/[id]/actions.ts`) — mirroir exact de
  `modifierLibelleLigneAction` : même permission
  (`treso.categoriser_demande`, inchangée), réutilise
  `creerCategorieInlineAction`/`creerObjetInlineAction` telles quelles (la
  création à la volée ne connaît pas la notion de ligne). Garde
  `ligne.statutValidation === "EN_ATTENTE"`, jamais le statut de la
  demande.
- **`categoriserDemandeAction`** reçoit le même gate
  `demande.lignes.length === 0` que les quatre actions de validation par
  montant — réservée désormais aux `DEPENSE_DIRECTE`.
- **`getMontantConsommeCategorie(categorieId)`** — **réécrite entièrement**,
  reste l'UNIQUE source de vérité (contrôle bloquant, aperçu
  `CategorisationForm`/`LignesValidationTable`, dashboard
  `getTopCategoriesBudget`, `getReportingSuiviBudgetaire` — aucun de ces
  appelants n'a de logique parallèle) : somme des
  `ReglementCategorieAllocation.montant` de cette catégorie dont le
  `Reglement` est confirmé et non annulé, au lieu de sommer directement
  les règlements par `Demande.categorieId`.

#### Règlement : allocation explicite par catégorie

`getCategoriesConcerneesDemande(demandeId)` (`tresorerie.ts`) détermine les
catégories distinctes concernées : lignes `VALIDEE` (uniquement — une
ligne encore `EN_ATTENTE`/`REJETEE` ne représente rien à régler) pour
`STANDARD`, `Demande.categorieId` unique pour `DEPENSE_DIRECTE`. Une ligne
`VALIDEE` sans catégorie n'ajoute rien à cette liste (aucune limite ne
s'applique à une portion non catégorisée, même principe qu'avant).

- **0 ou 1 catégorie concernée (le cas le plus fréquent, toute
  `DEPENSE_DIRECTE` incluse) : AUCUN changement visible pour Finance** —
  un seul champ montant comme avant cette tâche. `construireAllocations`
  (`reglementActions.ts`, partagée par création ET modification) crée
  automatiquement UNE allocation à 100% (ou aucune si 0 catégorie), de
  façon transparente.
- **≥ 2 catégories concernées** — `ReglementForm`/`ReglementRow` (édition)
  affichent, via `AllocationCategorieFields.tsx`, un champ de montant PAR
  CATÉGORIE (nommés `alloc_<categorieId>`, mêmes noms côté client et
  serveur), chacun avec un aperçu du budget restant (réutilise
  `getMontantConsommeCategorie`, jamais recalculé au changement de
  valeur — même convention que `BudgetCategorieApercu`). Validation
  stricte, client ET serveur (`construireAllocations`, comparaison en
  centimes entiers) : la somme doit égaler EXACTEMENT le montant total,
  refusée sinon.
- **`confirmerReglementAction`** — pour CHAQUE allocation du règlement,
  vérifie indépendamment `budgetAlloue(categorieId) −
  getMontantConsommeCategorie(categorieId) >= montant de cette
  allocation`. **Si UNE seule catégorie échoue, refuse la confirmation
  ENTIÈRE** (jamais de confirmation partielle — le contrôle s'exécute
  entièrement AVANT toute écriture, donc une catégorie saine n'est jamais
  touchée par le refus d'une autre) — message listant PRÉCISÉMENT chaque
  catégorie en dépassement et le montant alloué/restant. Vérifié en
  pratique : refus nommant uniquement la catégorie fautive, l'autre
  catégorie garde sa consommation exacte d'avant la tentative (aucun
  décompte fantôme).
- **Annulation** — aucune modification nécessaire : `getMontantConsommeCategorie`
  filtre déjà `reglement.estConfirme: true, estAnnule: false`, donc les
  allocations d'un règlement annulé cessent automatiquement de compter.
  Vérifié en pratique (règlement multi-catégorie confirmé puis annulé →
  les deux budgets redeviennent exactement ce qu'ils étaient avant ce
  règlement).
- **Reçu PDF** (`ReceiptDocument.tsx`) — si le règlement a plusieurs
  allocations, remplace les lignes "Catégorie"/"Objet" par une répartition
  ("Catégorie (X) : montant" par ligne) ; une seule allocation garde le
  rendu exact d'avant (pour `STANDARD`, la catégorie vient désormais de
  l'allocation elle-même plutôt que de `Demande.categorie`, toujours
  `null` pour ce type ; `objetLabel` reste `null` pour `STANDARD` — un
  règlement peut couvrir plusieurs lignes/objets d'une même catégorie,
  aucun "objet unique" n'existe plus à ce niveau).
- **Bon de caisse — DÉLIBÉRÉMENT non modifié** : déjà documenté comme
  "volontairement minimaliste", n'affiche jamais la catégorie ni le
  montant demandé/validé — y ajouter une répartition aurait contredit ce
  principe existant sans apporter de valeur à un document pensé pour
  rester minimal.
- **Export "Règlements"** — nouvelle colonne "Répartition par catégorie",
  vide pour un règlement à une seule catégorie (rendu inchangé, cette
  feuille n'avait jamais affiché de catégorie), renseignée pour un
  règlement multi-catégorie.

#### Reporting (`getReportingRows`/`getReportingFondsRemis`/`getReportingDemandesDetail`)

**"Unité comptable"** (`getUnitesComptables`, `reporting.ts`) — abstraction
qui unifie `DEPENSE_DIRECTE` (une unité = la demande entière, comportement
strictement inchangé) et `STANDARD` (une unité par LIGNE, chacune dans le
bucket de SA PROPRE catégorie/objet avec SON PROPRE montant), pour que le
bucketing Catégorie×Objet n'ait qu'un seul chemin de code.

- **"Demandé"/"Validé" par unité : exacts**, dérivés directement de
  `quantite × prixUnitaire` de la ligne (et de son `statutValidation`).
- **"Réglé"/"Réglé Caisse"/"Réglé Banque" : exacts** — dérivés de
  `ReglementCategorieAllocation`, jamais estimés. **Limite assumée et
  documentée dans le code** : une allocation ne descend qu'au niveau
  Catégorie, jamais Objet (le budget lui-même n'existe qu'à ce niveau) —
  si une demande a plusieurs lignes de MÊME catégorie mais d'Objets
  différents, chaque ligne Objet affiche le total "Réglé" de LA CATÉGORIE
  ENTIÈRE (la donnée la plus précise réellement disponible), avec un
  garde-fou (`demandeCategorieDejaComptee`) empêchant qu'une même
  (demande, catégorie) ne soit comptée deux fois dans les totaux agrégés.
- **`getReportingFondsRemis`** : `montantRemis` (Caisse) suit exactement le
  même principe (exact, par catégorie). **`depensesDeclarees`/
  `retoursRecus`, en revanche, n'ont AUCUNE dimension Catégorie dans le
  modèle de données** (un `RetourCaisse`/une `DepenseLigne` se rattachent
  à un `Reglement`, jamais à une Catégorie) — **seule estimation
  introduite par cette tâche** : répartie au prorata de la part de
  `montantRemis` que représente chaque catégorie dans le total remis de LA
  MÊME demande (ratio = 100% pour `DEPENSE_DIRECTE` ou toute `STANDARD`
  n'ayant qu'une seule catégorie concernée — comportement donc strictement
  inchangé dans ces deux cas très majoritaires). **Point signalé,
  non tranché unilatéralement** : accepter cette approximation pour ces
  deux seules colonnes, plutôt que de faire porter une Catégorie aux
  `DepenseLigne`/`RetourCaisse` eux-mêmes (changement de bien plus grande
  ampleur, hors périmètre de cette tâche).
- **`getReportingDemandesDetail`** (feuille Excel "Demandes") : une ligne
  = une ligne d'article pour `STANDARD` (nouvelle colonne "Ligne
  d'article"), une ligne = une demande pour `DEPENSE_DIRECTE`.
- **`getDemandesFiltrees`** — le filtre `categorieId`/`objetId` matche
  désormais `Demande.categorieId`/`objetId` OU `lignes.some({ categorieId,
  objetId })` (combiné via `AND: [...clauses]` explicite plutôt que deux
  propriétés `OR` dupliquées, impossibles dans le même objet littéral).
- Colonne "Nb. demandes" renommée **"Nb. lignes/demandes"** (écran +
  export) : compte désormais des LIGNES pour `STANDARD`, des demandes pour
  `DEPENSE_DIRECTE` — l'ancien intitulé aurait été trompeur.

#### Suppression de Catégorie/Objet

`supprimerCategorieAction`/`supprimerObjetAction` (`admin/categories/actions.ts`)
bloquent désormais aussi si `LigneDemande.count({ categorieId/objetId }) >
0`, en plus du contrôle existant sur `Demande` (qui ne concerne plus que
les `DEPENSE_DIRECTE`). Vérifié en pratique par rejeu réseau direct :
tentative de suppression d'une Catégorie/d'un Objet utilisé par une ligne
→ refusée, message listant précisément objets/demandes/lignes/budget en
cause.

#### Interface Finance — fusion dans le tableau de lignes

Pour les demandes `STANDARD`, la sélection Catégorie/Objet est fusionnée
directement dans `LignesValidationTable.tsx` (colonne "Catégorie / Objet"
par ligne, `LigneCategorisationCell` — mêmes Select en cascade, même
création à la volée, même aperçu de budget que `CategorisationForm.tsx`,
dont `BudgetCategorieApercu` est réutilisée telle quelle) plutôt qu'un
écran séparé. `CategorisationForm.tsx` reste utilisé tel quel UNIQUEMENT
pour les `DEPENSE_DIRECTE` — **le résumé demande-entière
(`CategorisationSummary`) a dû être explicitement masqué pour les
`STANDARD` dans les branches CLOTUREE et "montant validé > 0" de
`page.tsx`** (bug trouvé pendant la vérification : affichait à tort
"Non catégorisée" au niveau demande alors que ses lignes l'étaient
individuellement — corrigé).

Verrouillée dès que `ligne.statutValidation !== "EN_ATTENTE"` (comme côté
serveur) : l'éditeur ne s'affiche jamais pour une ligne déjà décidée, texte
en lecture seule uniquement.

#### Historique

`ACTION_LABELS` (`DemandeHistorique.tsx`) reçoit `categorisation_ligne`
(bug trouvé pendant la vérification : l'action s'affichait en clair, sans
libellé humanisé — corrigé) — rejoint `ACTIONS_GESTION_INTERNE` (même
principe que `CATEGORISER`/`modification_libelle_ligne` : la Catégorie/
l'Objet d'une ligne ne sont jamais montrés au Collaborateur, même
indirectement).

#### Vérifications, parcours réel + rejeu réseau (comptes de test réels)

- Demande à 2 lignes (Transport 60 000 FCFA catégorisé "Déplacements",
  Matériel 40 000 FCFA catégorisé "ACHat", budget de 30 000 FCFA
  temporairement posé sur "ACHat" pour le test) — catégorisation par ligne
  réussie via l'écran réel, les deux lignes validées (`montantValide` =
  100 000 FCFA).
- Règlement 1 (50 000 FCFA, répartition explicite Déplacements 30 000 /
  ACHat 20 000, budgets suffisants) → créé puis confirmé avec succès ;
  `getMontantConsommeCategorie` recoupé en base : ACHat = 20 000, Déplacements
  = 30 000 (exact, aucune estimation).
- Règlement 2 (50 000 FCFA restants, répartition Déplacements 20 000 / ACHat
  30 000 — ACHat atteindrait 20 000 + 30 000 = 50 000 > 30 000 de budget)
  → confirmation **refusée en entier**, message : `Ce règlement dépasse le
  budget disponible pour : « ACHat » (30 000 FCFA alloués, 10 000 FCFA
  restants) — confirmation refusée pour l'ensemble du règlement.`
  Recoupé en base : règlement resté `estConfirme: false`, ACHat toujours à
  20 000, **Déplacements toujours à 30 000 (totalement inaffecté)** —
  aucun décompte fantôme.
- Finance ajuste la répartition du brouillon (Déplacements 40 000 / ACHat
  10 000 — ACHat atteindrait exactement 30 000, la limite) → confirmation
  acceptée. Recoupé en base : ACHat = 30 000 (exactement le budget),
  Déplacements = 70 000.
- Annulation du règlement 2 (multi-catégorie, confirmé) → recoupé en base :
  ACHat revenu à 20 000, Déplacements revenu à 30 000 (les deux budgets
  redevenus disponibles, exactement l'état d'avant ce règlement).
- Suppression de la Catégorie "ACHat" et de l'Objet "materiel" (tous deux
  utilisés par une ligne) → refusées toutes les deux, message mentionnant
  explicitement "ligne(s) d'article" en plus des demandes/objets déjà
  comptés.
- Export Excel recoupé ligne par ligne : feuille "Demandes" montre bien 2
  lignes distinctes pour cette demande (une par ligne d'article, catégorie
  propre à chacune) ; feuille "Reporting" montre "ACHat"/"materiel" et
  "Déplacements"/"Transport" comme deux buckets séparés avec leurs propres
  colonnes Demandé/Validé/Réglé exactes ; feuille "Règlements" montre la
  répartition uniquement pour le règlement multi-catégorie, vide pour tous
  les règlements mono-catégorie préexistants (rendu inchangé) — et exclut
  correctement le règlement annulé de tous les totaux.
- Collaborateur : `grep` sur son propre écran de demande confirme zéro
  occurrence des catégories/objets utilisés ("Déplacements"/"ACHat"/
  "materiel" absents), y compris dans l'historique.
- Reçu PDF généré avec succès pour le règlement multi-catégorie ET pour un
  règlement mono-catégorie préexistant (aucune régression) — contenu texte
  non vérifiable dans cet environnement (pas d'extracteur PDF disponible),
  vérifié par relecture du code conditionnel (`route.tsx`).
- Aucune régression : dashboard Finance, écran de reporting, "À décaisser"
  tous chargés avec succès après les changements ; `JournalCaisse`/solde
  de caisse inchangés (tous les règlements de test en mode Banque,
  vérifié explicitement) ; `RegularisationSummary` affichée normalement
  sur l'écran de la demande de test.
- Nettoyage complet : demande de test, ses lignes, ses 2 règlements, leurs
  4 allocations et leur historique supprimés ; budget de "ACHat" restauré
  à `null` (illimité, son état d'origine) ; base revenue à ses 8 demandes
  (7 + la demande "DEPENSE GROUPE" du diagnostic précédent, non touchée).
- `tsc --noEmit` et `next build` (65 routes) passent sans erreur avant et
  après nettoyage.

#### Refonte visuelle en cartes + budget par ligne en temps réel

Suite directe de la fusion ci-dessus : le tableau HTML brut de
`LignesValidationTable.tsx` (défilement horizontal, colonnes serrées,
liens texte bleu plats) a été remplacé par une présentation en **cartes
empilées**, une par `LigneDemande` — plus aucun `<table>` dans ce
composant.

- **`LigneCard`** (remplace l'ancien `LigneRow`) — même classe de survol
  que `FinanceActionCard`/le reste du portail
  (`card-shadow-hover ... motion-safe:hover:-translate-y-0.5`, la seule
  technique qui fonctionne réellement dans ce projet, voir "Refonte
  visuelle du dashboard Finance" : `hover:shadow-elevated-lg` ne compile
  pas en Tailwind v4 ici). En-tête de carte : libellé mis en valeur à
  gauche (avec "Modifier" en pastille discrète, icône crayon, plus un lien
  texte bleu isolé) et le Total de la ligne à droite, en grand
  (`text-xl font-black tabular-nums`). Corps : Quantité × Prix unitaire en
  une seule ligne secondaire, petite taille, sous le libellé — ne
  concurrence plus visuellement le montant. Sous un séparateur
  (`border-t`), deux zones côte à côte (`grid sm:grid-cols-2`) : bloc
  Catégorie/Objet (badge + `LigneCategorisationCell`) et bloc Décision
  (boutons Valider/Rejeter, ou badge de statut si déjà décidée) — jamais
  de défilement horizontal requis, les deux blocs s'empilent
  naturellement sous `sm`.
- Le total courant "Montant qui sera validé : X FCFA" et le message d'aide
  sous "Enregistrer les décisions" (logique de `LignesValidationTable`
  elle-même : `decisions`/`toutesDecidees`/`motifsValides`/
  `peutEnregistrer`) sont restés **strictement inchangés** — seule la
  présentation de chaque ligne individuelle a changé.
- **`LigneBudgetApercu`** (nouveau) — affiche côte à côte le montant DE
  LA LIGNE (`quantite × prixUnitaire`, jamais un autre montant) et
  `BudgetCategorieApercu` (réutilisé tel quel depuis
  `CategorisationForm.tsx`, jamais recalculé séparément — même fonction
  que le contrôle bloquant du règlement et l'aperçu de
  `CategorisationForm`) pour la catégorie actuellement sélectionnée sur
  cette ligne précise. Rendu à deux endroits dans
  `LigneCategorisationCell` : une fois en lecture seule sous le badge
  (catégorie déjà assignée, éditeur fermé) et une fois **à l'intérieur du
  panneau d'édition ouvert**, keyé sur l'état local du `Select` (pas sur
  `ligne.categorieId`, qui ne change qu'après enregistrement) — change
  donc instantanément, sans requête réseau ni rechargement, dès que
  Finance sélectionne une autre catégorie dans la liste déroulante, en
  réutilisant le même tableau `budgetParCategorie` déjà chargé une seule
  fois par la page (même convention que l'aperçu de
  `CategorisationForm` : jamais recalculé au changement de `Select` côté
  client).
- Purement informatif, comme documenté pour `CategorisationForm` : aucun
  blocage ici, le contrôle bloquant réel reste exclusivement dans
  `confirmerReglementAction`.

**Vérifications, parcours réel (Playwright, comptes de test), desktop
(1280px) et mobile (390px) :**
- Zéro `<table>` restant, zéro défilement horizontal nécessaire aux deux
  largeurs pour lire une ligne complète (libellé, montant, catégorie,
  décision) — confirmé par inspection du DOM rendu, pas seulement par
  relecture de code.
- Sélection d'une catégorie sur une ligne encore non catégorisée →
  `LigneBudgetApercu` apparaît immédiatement dans le panneau d'édition,
  montant de la ligne et budget alloué/consommé/restant exacts, recoupés
  par une requête directe en base sur la même catégorie.
- Changement de catégorie sur la même ligne, éditeur toujours ouvert →
  l'aperçu bascule instantanément sur les chiffres de la nouvelle
  catégorie (y compris le cas "Aucun budget défini" pour une catégorie
  sans `budgetAlloue`), sans rechargement de page.
- Rechargement complet de la page sur une ligne déjà catégorisée mais pas
  encore décidée → l'aperçu réapparaît correctement en lecture seule avec
  les mêmes chiffres (vérifié avec des locators DOM précis après un
  faux-négatif initial dû à `innerText` sur un `<select>`, qui inclut le
  texte de toutes les `<option>`, pas seulement celle sélectionnée — sans
  rapport avec un bug applicatif, corrigé côté script de vérification
  uniquement).
- Deux lignes d'une même demande catégorisées différemment → chacune
  affiche exclusivement le budget de SA PROPRE catégorie (recoupé en
  base), jamais mélangé.
- Aucune régression : une ligne validée, une autre rejetée avec motif,
  "Enregistrer les décisions" correctement activé et fonctionnel ; le
  contrôle bloquant de `confirmerReglementAction` (allocation explicite,
  refus atomique multi-catégorie) inchangé et revérifié fonctionnel.
- `tsc --noEmit`, `eslint` et `next build` (65 routes) passent sans
  erreur.

### Catégorisation Finance : jamais de redirection après succès

`CategorisationForm.tsx` (`/treso/finance/demandes/[id]`) **reste toujours
sur l'écran de traitement** après un enregistrement réussi — jamais de
`router.push` vers la liste. `categoriserDemandeAction` ne change jamais
`statut` (la demande reste `EN_ATTENTE_VALIDATION`) : le `revalidatePath`
qu'elle appelle suffit à réafficher ce même formulaire, désormais
pré-rempli avec la catégorie/l'objet qui viennent d'être enregistrés, avec
`ValidationActions` toujours visible juste en dessous sur la même page —
Finance peut enchaîner catégoriser puis valider sans changer d'écran.

### Description du besoin modifiable avec traçabilité permanente

**Renommée depuis "Libellé de demande modifiable..."** — voir "Correction :
le bon champ était déjà ciblé" plus bas : l'ancien titre, utilisant le mot
"libellé", entretenait une confusion avec le catalogue Catégorie/Objet
(dont les entrées portent elles-mêmes un "libellé"/`label`). Le champ
concerné a toujours été, et reste, `Demande.description` — jamais un champ
d'`Objet`.

La "Description du besoin" (`Demande.description`, le motif écrit par le
collaborateur créateur à la création de sa demande) devient modifiable par
le Responsable Finance ET l'Assistant Finance, avec les deux versions
(initiale/courante) TOUJOURS visibles côte à côte dès qu'elles divergent —
jamais un remplacement silencieux, jamais besoin de cliquer pour voir
l'ancienne version.

**Mécanisme retenu : un champ simple (`Demande.descriptionOriginale`),
pas une table d'historique dédiée** — `descriptionOriginale` (`String?`,
migration `20260921135917_demande_description_originale`) reste `null`
tant que `description` n'a jamais été modifiée depuis la création (elle
fait alors office des deux versions à la fois) ; à la TOUTE PREMIÈRE
modification, `descriptionOriginale` est renseignée une seule fois
(`?? demande.description`, jamais réécrite ensuite même après une
deuxième/troisième modification) — `description` reste la version
COURANTE, modifiable autant de fois que nécessaire. Garde donc "version
initiale" et "version actuelle" en permanence, jamais chaque étape
intermédiaire (voir la tâche : "pas nécessairement chaque version
intermédiaire").

**Chaque modification est malgré tout tracée dans `HistoriqueEntry`**
(action `modification_description`, ancienne valeur dans `detail`) — pour
l'audit complet, cohérent avec la règle impérative du projet ("toute
opération importante historisée"), même si l'écran lui-même n'affiche que
les deux bornes.

- **`modifierDescriptionAction`** (`treso/finance/demandes/[id]/actions.ts`)
  — verrouillée une fois `CLOTUREE`, même principe que le reste du module.
  **Conflit de spécification rencontré et résolu avec le même schéma déjà
  validé pour "Restreindre 'Déléguer des accès'"** : la demande nommait
  `treso.valider_demande` OU `treso.effectuer_reglement`, mais
  `treso.valider_demande` seule n'exclut PAS le DG (qui la possède aussi).
  Garde retenue : **(`treso.valider_demande` ET PAS
  `treso.approuver_validation_complete`) OU `treso.effectuer_reglement`**
  — couvre Responsable Finance et Assistant Finance, exclut le DG et le
  Collaborateur, sans comparaison de nom de rôle. Repéré en pratique lors
  de la vérification (le DG a d'abord réussi une modification avant ce
  correctif) — jamais supposé correct sans test réel.
- **`DescriptionEditor.tsx`** (nouveau, colocalisé) — remplace le simple
  `<dd>{demande.description}</dd>` dans le bloc d'information partagé (en
  haut de page, rendu pour TOUS les statuts) : affiche "Description du
  besoin — version initiale (saisie par le collaborateur)" (si
  `descriptionOriginale` non nul) ET "Description du besoin — version
  modifiée"/"Description du besoin" (courante), avec un déclencheur
  "Modifier" ouvrant un `Textarea` inline (même convention que
  `MarquerNonJustifiee.tsx`). Toujours rendu, jamais conditionné par la
  permission côté page — déclencheur VISIBLE MAIS DÉSACTIVÉ (`disabled`)
  pour qui n'a pas le droit ou une fois clôturée, même principe "visible
  mais désactivé" que le reste du module depuis "Séparation Responsable
  Finance / Assistant Finance". **Libellés "Demande initiale"/"Demande
  modifiée" d'origine renommés** (voir "Correction" plus bas) — laissaient
  penser à tort qu'une autre entité pouvait être concernée.

**Choix documenté pour le Collaborateur créateur** (CDC ambigu sur ce
point précis, tranché plutôt que deviné) : `treso/demandes/[id]/page.tsx`
affiche désormais `demande.descriptionOriginale ?? demande.description`
— TOUJOURS la version originale si elle existe, jamais la version
modifiée par Finance, conformément à l'instruction "si ambigu, affiche
par défaut la version ORIGINALE". Le Collaborateur ne voit aucune trace
qu'une modification a eu lieu (ni bannière, ni mention) — `DemandeHistorique`
lui masque aussi les entrées `modification_description` (voir "Masquer
Catégorie/Objet côté historique Collaborateur" ci-dessous, même
mécanisme).

**Vérifications, parcours réel + rejeux réseau (comptes de test)** :
- Responsable Finance modifie la description → les deux versions
  ("Description du besoin — version initiale"/"version modifiée")
  visibles immédiatement sur son écran.
- Assistant Finance modifie à nouveau la même demande (déjà validée) →
  fonctionne identiquement, `descriptionOriginale` reste celle de la toute
  première modification (jamais écrasée par cette deuxième modification).
- DG : rejeu réseau direct refusé (`"Action non autorisée."`) — confirmé
  APRÈS correctif du conflit de permission ci-dessus (le premier essai,
  avant correctif, avait à tort réussi).
- Collaborateur : rejeu réseau direct refusé.
- Le Collaborateur créateur voit bien la description ORIGINALE sur son
  propre écran, jamais la version modifiée par Finance/Assistant —
  confirmé par inspection du HTML rendu. `HistoriqueEntry` complet (les 3
  modifications + catégorisation + validation) visible côté Finance,
  seule "Validation" visible côté Collaborateur.
- `tsc`/`eslint` clean, vrai `next build` réussi.

### Correction : le bon champ était déjà ciblé (pas un champ d'Objet)

Retour de compréhension : "le champ modifiable a été branché sur le
mauvais champ — pas une description liée à l'entité Objet, mais le
motif écrit par le demandeur à la création". **Diagnostic exhaustif fait
avant toute correction de logique** (schéma Prisma, code de l'action, du
composant, du câblage dans `page.tsx`, ET la documentation CLAUDE.md
préexistante de "Formulaire de demande (« Demande d'Achat »)") :

- `Demande.motif` **n'existe pas** dans le schéma — jamais existé. Le
  champ "Motif de l'achat"/"Description du besoin" saisi par le
  collaborateur (`Textarea` élargie à 7 lignes, voir "Formulaire de
  demande") est, et a toujours été, **`Demande.description`** — déjà
  documenté noir sur blanc AVANT même la tâche précédente : "même champ
  (`Demande.description`), pas un champ séparé".
- `Objet` (modèle du catalogue Catégorie/Objet) ne porte, et n'a jamais
  porté, aucun champ `description`/`descriptionOriginale` — ses seules
  colonnes réelles sont `id`/`label`/`isActive`/`categorieId` (confirmé
  par une requête directe en base sur un `Objet` réel).
- `descriptionOriginale` a été ajoutée sur `Demande` (migration
  `20260921135917_demande_description_originale`, juste à côté de
  `description`), jamais sur `Objet`. `modifierDescriptionAction` lit et
  écrit exclusivement `prisma.demande.update(...)`. `page.tsx` passe
  `description={demande.description}`/`descriptionOriginale=
  {demande.descriptionOriginale}` à `DescriptionEditor` — jamais
  `demande.objet.quoi que ce soit`.
- **Confirmé par requête directe en base** sur une demande de test ayant
  À LA FOIS une description modifiée ET une catégorie/objet réellement
  assignés (pour écarter tout doute) : `description`/`descriptionOriginale`
  bien portées par la ligne `Demande` elle-même (`categorieId`/`objetId`
  restent des colonnes voisines, sans aucun rapport) ;
  `HistoriqueEntry.entity = "Demande"` (jamais `"Objet"`) pour l'action
  `modification_description`.

**Conclusion : le bon champ était déjà ciblé depuis l'origine — aucune
correction de logique nécessaire.** Cause la plus probable de la
confusion, identifiée et corrigée (voir la section ci-dessus) : le mot
"libellé", utilisé à la fois dans le titre de section CLAUDE.md d'origine
("Libellé de demande modifiable...") ET dans le vocabulaire du catalogue
Catégorie/Objet (`label`, "Le libellé doit contenir au moins 2
caractères" dans les deux actions de création inline), ainsi que les
libellés d'écran "Demande initiale"/"Demande modifiée" (suggérant à tort
une duplication de la "Demande" entière plutôt qu'un seul champ texte) —
les deux tâches (description modifiable et catalogue Catégorie/Objet)
ayant en plus été livrées dans le même message, sur le même écran. Titre
de section et libellés d'écran renommés en conséquence (voir plus haut) ;
zéro changement de schéma, d'action ou de câblage de données.

### Bouton de catégorisation sans retour visuel

`CategorisationForm.tsx` : `isPending` (via `Button.loading`, déjà un
spinner intégré) ne suffisait pas — la soumission est souvent trop rapide
pour être perçue, et rien ne confirmait le succès SUR le bouton lui-même
(seule la notification `sonner` externe le faisait, découplée
visuellement de l'action qui vient d'être cliquée).

- Texte du bouton désormais explicite pendant l'attente
  ("Enregistrement...", pas seulement le spinner).
- **Confirmation visuelle brève au succès** : bascule "Enregistré ✓"
  (icône `circle-check` + texte) pendant 1,8 seconde après chaque
  `state.status === "success"` — réaction ponctuelle à un `ActionState`
  via `useEffect`/`setTimeout` (même pattern déjà établi dans
  `DepenseDirecteForm.tsx` : jamais un état dérivé du rendu, un
  `eslint-disable-next-line react-hooks/set-state-in-effect` documenté).
- Vérifié par revue de code + rejeu réseau de `categoriserDemandeAction`
  (confirme que le `state.status` transite bien vers `"success"`,
  déclenchant l'effet) — **le rendu visuel exact du bouton dans le temps
  (avant/pendant/juste après clic) n'a pas pu être observé par capture
  d'écran dans cet environnement**, aucun outil de test visuel/navigateur
  disponible ici (même limite déjà documentée pour d'autres tâches UI de
  ce projet).

### Visibilité des catégories/objets existants pendant la catégorisation

**Diagnostic** : la création d'Objet "à la volée" (`creerObjetInlineAction`,
réservée à `treso.categoriser_demande`) existait déjà depuis l'origine —
un Select "Objet" propose toujours "+ Ajouter un nouvel objet" et ouvre
automatiquement le panneau de création si la catégorie choisie n'a encore
aucun objet. **Ce qui manquait précisément** : (1) aucun aperçu visuel des
paires Catégorie→Objets existantes — les deux `Select` restaient
totalement indépendants, sans jamais montrer à Finance ce qui existe déjà
avant de choisir ; (2) aucun moyen de créer une nouvelle CATÉGORIE depuis
cet écran (seul l'Objet avait son mécanisme à la volée).

- **`creerCategorieInlineAction`** (nouveau, `actions.ts`) — mirroir exact
  de `creerObjetInlineAction` : même garde (`treso.categoriser_demande`,
  PAS `treso.gerer_categories` — cohérence délibérée entre les deux
  créations inline, jamais l'une plus permissive que l'autre), même
  historisation, mêmes chemins revalidés. Nouvelle option "+ Ajouter une
  nouvelle catégorie" dans le Select "Catégorie" (même sentinelle
  `VALEUR_NOUVELLE_CATEGORIE` que `VALEUR_NOUVEL_OBJET`), panneau de
  création inline identique — deux mécanismes symétriques, jamais l'un
  plus élaboré que l'autre.

**Correction (retour "l'ajout précédent a mal visé") : l'aperçu retiré,
jamais réintroduit.** Le premier essai avait aussi ajouté un
`CatalogueApercu` (liste/accordéon permanent de toutes les catégories
avec leurs objets, affiché au-dessus du Select) — **jugé après coup comme
compliquant l'écran plutôt que de le simplifier**, mélangeant
consultation et création dans un même bloc visuel alors que la demande
réelle était un flux simple en deux temps distincts (sélection, PUIS
création séparée si besoin). `CatalogueApercu` entièrement supprimé
(composant + son rendu) — l'écran revient à sa forme originale (deux
`Select` indépendants, Catégorie puis Objet filtré par la catégorie
choisie), avec les deux SEULS ajouts qui restent : l'option "+ Ajouter
une nouvelle catégorie" (nouvelle) et "+ Ajouter un nouvel objet"
(préexistante depuis l'origine) — chacune ouvrant son propre petit
panneau de création séparé, jamais une liste mélangée. Aucune régression
sur `BudgetCategorieApercu` (aperçu du budget de la Catégorie
SÉLECTIONNÉE, sans rapport avec le catalogue complet, non concerné par
cette correction).

**Vérifications, parcours réel + rejeux réseau (comptes de test)** :
- Écran confirmé plus simple : aucun aperçu/accordéon Catégorie→Objets
  visible, seulement les deux `Select` + les deux options de création.
- Sélection d'une catégorie et d'un objet déjà existants → enregistrement
  réussi sur la demande (`categoriserDemandeAction`), sans aucune liste
  superflue affichée.
- Catégorie inexistante → création simple via "+ Ajouter une nouvelle
  catégorie" (`creerCategorieInlineAction`), résultat immédiatement
  sélectionnable et utilisé avec succès pour catégoriser la demande de
  test.
- Objet inexistant (catégorie existante) → identique, comportement
  strictement inchangé depuis avant cette tâche (mécanisme d'origine du
  projet, jamais modifié).
- `tsc`/`eslint` clean, vrai `next build` réussi.

### Masquer Catégorie/Objet côté historique Collaborateur

La Catégorie et l'Objet assignés par Finance sont une information de
gestion interne — jamais destinée au Collaborateur créateur. Retirés de
`treso/demandes/[id]/page.tsx` (deux blocs `<dd>` en moins, `include`
Prisma `categorie`/`objet` retiré, devenu inutile sur cet écran).

**Fuite indirecte trouvée et corrigée en vérifiant "qu'aucune autre
information sensible équivalente n'y est exposée par erreur"** :
`DemandeHistorique.tsx` (rendu sans filtre sur cette même page) affichait
en clair, via l'entrée `HistoriqueEntry` `CATEGORISER`, le libellé de la
catégorie ET de l'objet choisis par Finance (`detail: "Catégorie « X »,
objet « Y »"`) — exactement l'information que la tâche demande de
masquer, révélée par un chemin détourné. La nouvelle action
`modification_description` (voir "Libellé de demande modifiable"
ci-dessus) aurait posé le même problème dans l'autre sens : révéler au
Collaborateur qu'une modification a eu lieu et le contenu de l'ancienne
version, contredisant le choix de ne lui montrer que la version
originale, silencieusement.

- **`DemandeHistorique`** — nouvelle prop `masquerGestionInterne` (défaut
  `false`) : exclut les actions `CATEGORISER`/`modification_description`
  de la requête (`ACTIONS_GESTION_INTERNE`, un `Set` explicite plutôt
  qu'une liste dupliquée). Passée `true` UNIQUEMENT depuis l'écran
  Collaborateur ; l'écran Finance continue de tout voir, sans filtre.
- Recherche exhaustive faite avant correction (`grep` sur `categorie`/
  `Categorie`/`objet.label` dans tous les écrans Collaborateur : "Mes
  demandes", "Mon tableau de bord", règlements reçus, retours de caisse) —
  aucune autre exposition trouvée.

**Vérifications, parcours réel (comptes de test)** :
- Compte Collaborateur : Catégorie/Objet absents du détail de sa demande,
  ET absents de son historique (seule "Validation" visible, sur 5
  entrées réelles) — confirmé par inspection du HTML rendu, pas seulement
  supposé depuis le code.
- Compte Finance : Catégorie/Objet et historique complet (Catégorisation
  + 3 modifications de description + Validation) toujours visibles
  normalement sur son propre écran — aucune régression.
- `tsc`/`eslint` clean, vrai `next build` réussi (66 routes).

### Détail des dépenses sur l'écran de Régularisation

Retour Finance : la carte « Régularisation » (`RegularisationSummary.tsx`,
`treso/finance/demandes/[id]/page.tsx`) n'affichait « Dépenses effectuées »
qu'en un seul montant agrégé (justifiées + non justifiées combinées) —
Finance voulait la répartition, et pouvoir agir sur la justification
directement depuis cet écran plutôt que de devoir aller sur
`/treso/finance/retours`.

- **Diagnostic préalable** : le calcul séparé n'existait qu'implicitement
  (`getMontantNonJustifie`, par `RetourCaisse`, pas par `Demande`) —
  aucune fonction n'exposait déjà la répartition au niveau d'une demande
  entière. `marquerDepenseNonJustifieeAction` (`treso/finance/retours/retourActions.ts`)
  existait déjà et n'était jusqu'ici utilisable que depuis
  `/treso/finance/retours` (`RetoursEnAttenteTable.tsx`, qui ne liste que
  les retours PAS ENCORE réceptionnés).
- **`getDepensesDeclareesParJustification(demandeId)`** (nouvelle,
  `backend/src/tresorerie.ts`) — deux `aggregate` sur le même périmètre
  exact que `getDepensesDeclarees` (jamais un second calcul divergent),
  un avec `justification: "SANS_PIECE"`, l'autre sans filtre ; la
  différence donne le montant justifié. La somme des deux vaut toujours
  l'ancien total unique — `ecart` (`RegularisationSummary`) continue de
  sommer les deux, formule strictement inchangée.
- **`getDepenseLignesDetail(demandeId)`** (nouvelle, même fichier) —
  détail ligne par ligne de TOUTES les `DepenseLigne` de la demande (tous
  ses `RetourCaisse`, réceptionnés ou non — contrairement à
  `RetoursEnAttenteTable` qui ne montre que les non-réceptionnés),
  `pieceJointeId`/`motifNonJustifie`/`retourEstReceptionne` inclus pour
  que l'appelant sache si l'action de marquage reste possible.
- **`RegularisationSummary.tsx`** — nouvelle prop optionnelle
  `canGererJustification` (défaut `false`) : affiche, EN PLUS de
  l'éclatement justifiées/non justifiées (toujours visible, y compris
  côté Collaborateur), le détail ligne par ligne avec lien "Voir la pièce
  jointe" et l'action "Marquer non justifiée". **Jamais transmise depuis
  l'écran Collaborateur** (`treso/demandes/[id]/page.tsx`, reste
  volontairement en lecture seule) — passée `true` uniquement depuis
  `treso/finance/demandes/[id]/page.tsx`, calculée avec la même permission
  que l'action elle-même revérifie déjà côté serveur
  (`treso.receptionner_retour`), et seulement dans la branche active (pas
  la branche `CLOTUREE`, où `ClotureActions` explique déjà qu'aucune
  action n'est plus possible — afficher le bouton là aurait proposé une
  action vouée à l'échec serveur).
- **`MarquerNonJustifiee.tsx`** (nouveau, `components/tresorerie/`) —
  extrait tel quel de `RetoursEnAttenteTable.tsx` (même comportement,
  même appel à `marquerDepenseNonJustifieeAction`) pour être réutilisé par
  `RegularisationSummary` sans dupliquer l'implémentation ; `RetoursEnAttenteTable.tsx`
  importe désormais ce composant partagé au lieu de sa copie locale
  (supprimée).
- Ligne déjà réceptionnée sans motif : message « Retour déjà réceptionné :
  justification définitivement verrouillée. » à la place du bouton
  (jamais un bouton voué à l'échec serveur) — la ligne conserve son lien
  pièce jointe, indépendant du statut de justification.

**Vérifications, parcours réel + rejeux réseau (demande jetable, cycle
complet création → validation → règlement Caisse confirmé → retour
déclaré avec 2 lignes) :**
- Retour à 2 lignes (6 000 FCFA avec facture + pièce jointe, 4 000 FCFA
  sans pièce) → carte affiche « Dépenses justifiées : 6 000 FCFA » /
  « Dépenses non justifiées : 4 000 FCFA », somme 10 000 FCFA identique à
  l'ancien total unique, Solde à régulariser toujours à 0 (formule
  inchangée, vérifiée avant/après).
- Lien « Voir la pièce jointe » présent pour la ligne avec facture,
  absent (« Aucune pièce jointe. ») pour l'autre — conforme aux données
  réellement attachées.
- **Marquage non justifiée depuis ce nouvel emplacement testé pour de
  vrai** : la ligne à 6 000 FCFA (facture) marquée non justifiée via
  `marquerDepenseNonJustifieeAction` appelée depuis cette carte → relecture
  de la page : « Dépenses justifiées : 0 FCFA » / « Dépenses non
  justifiées : 10 000 FCFA » (somme toujours 10 000), motif Finance
  affiché avec l'auteur, Solde à régulariser inchangé (0).
- **Verrou de réception revérifié depuis ce nouvel emplacement** : retour
  réceptionné, puis nouvelle tentative de marquage sur l'autre ligne (non
  encore marquée) → refusée par le serveur (« Ce retour de caisse a déjà
  été réceptionné... »), page affichant bien le message de verrouillage à
  la place du bouton.
- Nettoyage : règlement annulé (compense exactement l'écriture
  `JournalCaisse` de sa confirmation — impact net vérifié à 0 avant
  suppression), retour/lignes/demande/historique supprimés ensuite.
- `tsc`/`eslint` clean, vrai `next build` réussi (65 routes).

### Tableau de bord collaborateur détaillé

`treso/tableau-de-bord/page.tsx` (Collaborateur) affiche, sous les 5
indicateurs agrégés et les zones "À traiter"/"Retours de caisse", une
nouvelle section "Mes demandes" (`MesDemandesDetailTable.tsx`) listant
**chaque demande séparément** — jamais agrégées derrière les indicateurs
globaux — avec son statut, son montant reçu (fonds remis) et son propre
état de régularisation.

- **`getMesDemandesDetail(userId)`** (`backend/src/tresorerie.ts`) —
  réutilise directement `getTotalRegle`/`getDepensesDeclarees`/
  `getRetoursRecus` (les mêmes fonctions déjà partagées par
  `RegularisationSummary`/`getEcart`) plutôt que d'appeler `getEcart`
  telle quelle : cette dernière recalculerait `getTotalRegle` une seconde
  fois en interne pour arriver au montant déjà nécessaire par ailleurs
  comme "montant reçu" (voir "Diagnostic de latence — requêtes
  redondantes" ci-dessous) — la formule du solde à régulariser reste
  rigoureusement identique (`totalRegle - depensesDeclarees -
  retoursRecus`), seul le double appel est évité.
- N+1 assumé (3 agrégats par demande, une requête `Promise.all` par
  demande) : le volume de demandes d'un seul Collaborateur reste toujours
  modeste (même hypothèse que `getReglementsCaisseADeclarer`), pas la
  même échelle qu'un écran Finance portant sur toute l'organisation.
- **État de régularisation affiché** (`EtatRegularisation`,
  `MesDemandesDetailTable.tsx`) : "Rien reçu pour l'instant" si aucun
  règlement encore confirmé ; "Régularisée" si le solde à régulariser vaut
  exactement 0 ; "À régulariser : X FCFA" (teinte `warning`) si positif ;
  "Anomalie : X FCFA en trop justifiés/retournés" (teinte `danger`) si
  négatif — jamais plafonné à 0, même principe que `getSoldeARegulariser`.
  Icônes ajoutées à cette présentation (voir "Modernisation du dashboard
  Collaborateur" ci-dessous) sans toucher au contenu ni aux seuils.

### Modernisation du dashboard Collaborateur

Refonte visuelle de `treso/tableau-de-bord/page.tsx`, même esprit que la
refonte du dashboard Finance (cartes à badge d'icône, graphiques réels
tirés des vraies données) mais avec sa propre identité, jamais un
copier-coller. Skill `frontend-design` (`/mnt/skills/public/frontend-design/
SKILL.md`) demandée en préalable : **chemin inexistant sur cet
environnement** (même constat déjà fait pour la refonte de FeedbackApp) —
appliqué à la place les patterns déjà établis (`FinanceActionCard.tsx`,
`SoldeCaisseTrendChart.tsx`, `ReglementsModeDonut.tsx`).

- **`CollaborateurStatCard.tsx`** (nouveau, colocalisé avec la page) —
  remplace `StatCard` pour les 5 cartes "Vue d'ensemble" UNIQUEMENT.
  **`StatCard` (partagé avec DG/Admin/Finance) n'est pas modifié** —
  confirmé par un diff vide sur ce fichier, et par un grep confirmant que
  `CollaborateurStatCard`/`CollaborateurDemandesBarChart`/
  `TauxRegularisationGauge` ne sont importés nulle part ailleurs que par
  cette seule page. Identité distincte de `FinanceActionCard` (qui l'a
  inspiré) : badge CIRCULAIRE en haut-DROITE (`FinanceActionCard` : badge
  carré en haut-gauche), libellé au-dessus du badge plutôt qu'en dessous,
  pictogramme fantôme surdimensionné en bas-droite (très faible opacité,
  flourish propre à cette carte). Survol : élévation + léger fond teinté
  par `tone` (`.card-shadow-hover`, même classe déjà nécessaire ailleurs
  car `hover:shadow-elevated-lg` ne compile pas dans ce projet — voir
  "Refonte visuelle du dashboard Finance").
- **`getMesDemandesParMois(userId, nombreDeMois = 6)`** (nouvelle fonction,
  `backend/src/tresorerie.ts`) — montant DEMANDÉ (`Demande.montant`, pas
  `montantValide`) par mois calendaire, fenêtre de 6 mois glissants
  (volume mensuel d'un seul Collaborateur toujours modeste — une fenêtre
  de 12 mois multiplierait surtout les mois à 0). Renvoie TOUS les mois de
  la fenêtre, y compris à 0 — c'est `CollaborateurDemandesBarChart.tsx`
  qui décide, lui, si la fenêtre entière est vide.
- **`CollaborateurDemandesBarChart.tsx`** — barres SVG tracées à la main
  (même choix que `SoldeCaisseTrendChart.tsx` : volume toujours modeste),
  montant affiché au-dessus de chaque barre (jamais de `<title>` SVG —
  piège React 19 déjà documenté : hissé vers `<head>`, casse
  l'hydratation). **Deux états vides distincts** : aucune demande n'a
  JAMAIS existé (`aDejaDesDemandes: false`, message identique à celui de
  `MesDemandesDetailTable` pour rester cohérent) vs. aucune demande sur la
  fenêtre récente alors que l'historique existe (message différent,
  jamais confondu).
- **Taux de régularisation** (`TauxRegularisationGauge.tsx`) — anneau SVG
  (même technique que `ReglementsModeDonut.tsx`, un seul arc). **Ne
  recalcule strictement rien** : `demandesReglees`/`demandesRegularisees`
  sont dérivés dans `page.tsx` du même tableau déjà renvoyé par
  `getMesDemandesDetail` (`montantRecu > 0` / `soldeARegulariser === 0` —
  exactement les mêmes seuils que `EtatRegularisation`), zéro requête
  supplémentaire. Teinte selon le taux (danger &lt;40%, warning 40-79%,
  success ≥80%) — tokens sémantiques déjà existants, aucune nouvelle
  échelle de couleur inventée pour ce seul indicateur.

**Vérifications, recoupement DB direct** :
- **"Demandé" recoupé** : 2 demandes réelles pré-existantes (37 000 FCFA)
  + 2 demandes de test créées via les vraies Server Actions (8 000 FCFA ce
  mois-ci, 15 000 FCFA le mois précédent — `createdAt` corrigé
  directement en base pour ce seul champ, aucune autre donnée simulée) →
  dashboard affiche bien "60 000 FCFA", confirmé par une requête directe
  en base sur les 4 lignes.
- **Taux de régularisation recoupé et testé en transition réelle** : cycle
  complet via les vraies Server Actions (création → validation totale →
  règlement Caisse créé puis confirmé → jauge à 67% = 2/3, teinte
  `warning`, valeur recoupée par un calcul direct
  `getTotalRegle`/`getDepensesDeclarees`/`getRetoursRecus` en base) →
  retour de caisse déclaré (formulaire simplifié, tout retourné) puis
  réceptionné par Finance → jauge repasse à 100% = 3/3, teinte `success` —
  la transition demandée par la tâche a été observée pour de vrai, pas
  seulement en théorie.
- **Graphique testé avec 2 demandes à des mois différents** : la barre du
  mois précédent (15 000 FCFA) et celle du mois courant (8 000 + 12 000 +
  25 000 déjà existants) apparaissent distinctement, total affiché "60 000
  FCFA" cohérent avec la somme des deux mois.
- **Nettoyage** : les deux demandes de test, leur règlement et leur retour
  de caisse supprimés après vérification (ordre de dépendance respecté :
  `LigneDemande` → `RetourCaisse`/`Reglement` → `Demande`). **Les écritures
  `JournalCaisse` créées par ce test n'ont volontairement PAS été
  supprimées** — `JournalCaisse` n'a aucune vraie relation Prisma vers
  `Demande` (`refId` est un simple `String`, jamais une clé étrangère), et
  CLAUDE.md documente déjà cette table comme un grand livre append-only
  ("jamais réécrit ni supprimé") : l'entrée SORTIE (règlement) et l'entrée
  ENTRÉE (retour) s'annulent exactement (impact net nul sur le solde de
  caisse réel), cohérent avec ce principe plutôt qu'une exception ad hoc
  pour des données de test. Dashboard revérifié après nettoyage : revenu
  exactement à l'état d'origine (37 000 FCFA, 2/2 régularisées, 100%).
- **Aucune régression** : `StatCard.tsx` diff vide (jamais modifié) ;
  dashboards Finance, DG (général), Admin et le dashboard général en tant
  que Collaborateur tous testés après la refonte, chargent normalement.
- **Rendu mobile** : vérifié par relecture de code (grilles
  `grid-cols-1 sm:...`/`lg:grid-cols-2` qui empilent sous leurs seuils,
  jauge en `flex-wrap` pour éviter tout débordement horizontal, graphique
  en barres en SVG `viewBox` + `w-full` qui se redimensionne
  proportionnellement) — pas de capture d'écran ni de test visuel réel
  possible dans cet environnement.

### Diagnostic d'une régression visuelle perçue sur la page racine — aucune cause de code trouvée

Signalement : les cartes "Vos accès" de la page racine sembleraient
réduites depuis la refonte FeedbackApp et celle du dashboard Collaborateur.
Diagnostic exhaustif fait AVANT toute correction :

- **`globals.css`** entre le commit précédant la refonte FeedbackApp et
  l'état courant : 127 lignes strictement AJOUTÉES, zéro ligne modifiée ou
  supprimée — toutes sous des noms de classe spécifiques
  (`.feedback-hero-bg` à l'époque, `.animate-select-pop`,
  `.animate-step-in`, `.animate-confirm-ring`), aucune classe générique ni
  token `@theme` partagé (couleurs, espacement, `ease-out-strong`,
  `.shadow-elevated`) touché.
- **`(dashboard)/page.tsx`** (page racine) : diff vide depuis un commit
  largement antérieur à toutes les tâches de cette session — ni les tâches
  FeedbackApp, ni celle du dashboard Collaborateur ne l'ont touché.
- **Composants partagés vérifiés un par un** (diff vide sur tous) :
  `StatCard.tsx`, `FinanceActionCard.tsx`, le layout du groupe
  `(dashboard)`, `AppShell.tsx`, `Sidebar.tsx`, `Topbar.tsx`, `Badge.tsx`,
  `PageHeader.tsx`, `EmptyState.tsx`. Seul `icons.tsx` a été touché, de
  façon strictement additive (une icône `star` ajoutée, aucune icône
  existante modifiée).
- **Vérifié en direct** : cache Turbopack vidé, serveur redémarré à froid,
  page racine chargée pour de vrai — le HTML rendu contenait exactement
  les classes attendues du code source, sans substitution ni artefact de
  cache.

**Conclusion (avant la tâche suivante, qui a depuis intentionnellement
changé le style de ces cartes — voir "Cartes de modules de la page
racine" ci-dessous)** : aucune preuve de code n'expliquait la différence
perçue à ce stade — signalé tel quel plutôt que de forcer une correction
sans cause identifiée.

### Cartes de modules de la page racine — fond bleu plein + logo (décision produit)

Suite au diagnostic ci-dessus (aucune régression de code trouvée), demande
produit explicite de changer délibérément le style des cartes "Vos accès"
(`(dashboard)/page.tsx`) : fond blanc + badge d'icône coloré par module →
fond bleu SIM Assurances plein + logo de l'entreprise, identique sur
toutes les cartes.

- **`.brand-gradient-bg`** (`globals.css`) — l'ancienne classe
  `.feedback-hero-bg` (bandeau hero de FeedbackApp) a été RENOMMÉE et
  généralisée plutôt que dupliquée : même dégradé (`#004B9C` → survol
  radial `#51AEE2`, voir plus haut "FeedbackApp — refonte visuelle"),
  réutilisé tel quel ici plutôt que d'inventer une nouvelle valeur de
  couleur — cohérent avec la demande explicite de réutiliser l'existant.
  Le hero de FeedbackApp utilise maintenant cette même classe renommée,
  sans changement visuel pour lui.
- **Logo** : ~~affiché dans une pastille `bg-white/15`~~ — traitement
  **remplacé** par un filigrane, voir "Cartes de modules de la page
  racine — filigrane logo (ajustement)" ci-dessous. À l'origine (cette
  tâche) remplaçait l'ancien badge d'icône par module (`MODULE_ICON`,
  entièrement retiré — devenu mort) par le logo, identique sur les 4
  cartes (FeedbackApp, Gestion des demandes et trésorerie, Pointage RH,
  Administration) — plus aucune icône différente par module ; ce
  principe (un seul logo, pas d'icône par module) reste vrai après
  l'ajustement, seul le TRAITEMENT du logo a changé.
- **Texte** : titre en `text-white` (gras, comme avant), description/lien
  "Accéder au module" en `text-white/80` s'éclaircissant en `text-white`
  au survol (`group-hover`) — hiérarchie titre/description préservée,
  juste la couleur de base adaptée au fond sombre.
- **État désactivé** ("Bientôt disponible"/"Aucun accès", cartes sans
  `href`) : reçoit lui aussi le fond bleu (plus de fond blanc pour ce
  state), à `opacity-60` (contre `0.75` avant — légèrement plus estompé
  pour rester distinct des cartes actives, qui sont maintenant, elles
  aussi, en bleu). Le badge n'utilise plus le composant partagé `Badge`
  (ses variantes `bg-*-bg`/`text-*` sont calibrées pour un fond clair,
  risque réel de mauvais contraste ou de bataille de spécificité Tailwind
  en tentant de le surcharger) : un `<span>` dédié à cette carte
  (`border-white/40 bg-white/15 text-white`), plus sûr qu'une tentative de
  surcharge du composant partagé.
- **Survol** : `.card-shadow-hover` (déjà la seule technique qui fonctionne
  réellement dans ce projet — voir "Refonte visuelle du dashboard
  Finance", `hover:shadow-elevated-lg` ne compile pas) + `hover:brightness-110`
  (filtre CSS réel, remplace l'ancien `scale-110` du badge d'icône,
  disparu avec le badge lui-même) + translation verticale déjà existante
  inchangée.
- L'ancienne barre d'accent de tête (`bg-primary` sur un fond déjà bleu
  aurait été invisible) a été retirée — le fond plein est maintenant lui
  même le signal de couleur.

**Vérifications, plusieurs comptes de test réels** :
- Comparaison des occurrences de `brand-gradient-bg` sur la page rendue
  entre 5 comptes (Collaborateur, RH, DG, Admin, Finance) : nombre de
  cartes cohérent dans chaque cas avec les permissions réelles de chaque
  rôle (ex. Finance : Trésorerie + FeedbackApp seulement, RH : Pointage +
  FeedbackApp seulement).
- Logo confirmé présent sur chacune des 4 cartes nommées par la tâche
  (recherche de l'attribut `src="/logo-sim-blanc.svg"` dans le HTML rendu),
  aucune icône par module résiduelle.
- **État désactivé testé pour de vrai** : le rôle "Admin" de cette base
  porte depuis longtemps une anomalie déjà documentée (23 `RolePermission`
  réelles, voir "estAdmin — accès à la console /admin") qui lui donne en
  pratique accès à tous les modules — il ne permettait donc pas d'observer
  la carte désactivée. Un rôle et un compte de test temporaires
  (`estAdmin: true`, zéro `RolePermission`) ont été créés spécifiquement
  pour exercer ce chemin de code, vérifiés (fond bleu, logo, badge "Aucun
  accès" en blanc bien lisible à `opacity-60`), puis supprimés
  (`HistoriqueEntry` de connexion supprimée en premier, seule ligne
  bloquant la suppression du compte).
- **Aucune régression** : en-tête ("Tableau de bord") et section
  notifications confirmés inchangés sur la page rendue.
- **Rendu mobile** : grille `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
  strictement inchangée (seul le contenu interne des cartes a changé, pas
  la grille qui les contient) — aucun nouveau risque de mise en page
  introduit.
- `tsc`/`eslint` clean, vrai `next build` réussi.

### Cartes de modules de la page racine — filigrane logo (ajustement)

Correction directe demandée après la tâche ci-dessus : la pastille
`bg-white/15` contenant le logo (petit badge, `<Image src="/logo-sim-blanc.svg">`)
jugée incohérente avec le seul autre endroit du portail qui affiche déjà le
logo sur un fond bleu plein — le bandeau hero de FeedbackApp
(`FeedbackHero()`, `app/feedback/page.tsx`), qui utilise un **grand
filigrane pâle** du pictogramme en arrière-plan, pas un badge. Demande :
reproduire exactement ce traitement sur les 4 cartes "Vos accès".

- **Pastille entièrement retirée** — le `<span className="bg-white/15
  px-3 py-2">` contenant `<Image src="/logo-sim-blanc.svg">` a disparu des
  3 branches de rendu (carte accessible, carte désactivée, carte
  Administration). L'import `next/image` a été retiré de la page (plus
  aucun usage).
- **`ModuleCardWatermark()`** (nouveau, `(dashboard)/page.tsx`) — reproduit
  la technique du hero au trait près : `BRAND_ICON_PATHS`/
  `BRAND_ICON_VIEWBOX` (le pictogramme triangle seul, déjà factorisé dans
  `@/components/ui/brandIcon` et déjà réutilisé par la Sidebar réduite et
  `BrandBackdrop` — jamais le fichier `logo-sim-blanc.svg`, qui contient le
  texte "SIM Assurances" et ne convient pas à un filigrane décoratif),
  `fill="currentColor"` sur chaque `<path>` (résout en blanc via le
  `text-white` déjà hérité de la carte), `pointer-events-none absolute`
  débordant en haut à droite, `aria-hidden="true"`.
- **Taille volontairement réduite par rapport au hero** — `size-24
  sm:size-32` (96px/128px) contre `size-56 sm:size-72` (224px/288px) sur le
  hero, offset `-right-6 -top-6` contre `-right-10 -top-10`, opacité
  `0.14` contre `0.12` (légèrement remontée pour rester perceptible à
  cette taille réduite). **Déviation assumée, pas un oubli** : le hero est
  un bandeau pleine largeur (`px-10 py-14`), ces cartes sont de petits
  panneaux `p-5` en grille 1/2/3 colonnes — reproduire les 224-288px du
  hero y aurait fait dominer visuellement le titre/texte de la carte,
  contredisant l'exigence de lisibilité de la tâche. Même langage visuel
  (style, position, transparence, source SVG), taille proportionnelle au
  conteneur.
- **Carte désactivée** : le `<div className="flex items-start
  justify-between gap-2">` qui alignait pastille + badge côte à côte a été
  simplifié en `<div className="relative flex justify-end">` ne portant
  plus que le badge "Bientôt disponible"/"Aucun accès" (le filigrane
  devient un élément de fond indépendant, plus un élément de cette ligne
  flex).
- **`relative` ajouté sur titre/description/lien** (`h3`/`p`) des 3
  branches — le filigrane étant le premier enfant `absolute` du
  conteneur, le texte doit explicitement se replacer dans le flux normal
  au-dessus de lui (`position: relative` suffit avec l'ordre naturel du
  DOM, sans z-index nécessaire).
- Fond dégradé (`.brand-gradient-bg`), texte blanc, et survol
  (`.card-shadow-hover`/`hover:brightness-110`) strictement inchangés —
  seul le traitement du logo a été modifié, conformément à la demande.

**Vérifications, comptes de test réels + inspection du HTML rendu** :
- **Cohérence visuelle avec le hero FeedbackApp confirmée** : même SVG
  (`viewBox="0 0 114 94"`, mêmes 3 `<path>` de `BRAND_ICON_PATHS`), même
  technique de positionnement/opacité/`fill="currentColor"`, seule la
  taille diffère (proportionnellement au conteneur, voir ci-dessus).
- **Les 4 cartes affichent le filigrane** : vérifié par connexion réelle
  (Collaborateur → 3 cartes, Admin → 4 cartes avec Administration) et
  inspection du HTML renvoyé — un `<svg>` filigrane par carte, zéro trace
  résiduelle de l'ancienne pastille (`grep` sur `bg-white/15 px-3 py-2` :
  0 occurrence dans les deux cas).
- **Texte parfaitement lisible malgré le filigrane** : classes
  `text-white`/`text-white/80` sur titre/description/lien inchangées,
  filigrane à opacité `0.14` uniquement (jamais superposé au-dessus du
  texte grâce à `relative` sur ce dernier).
- **État désactivé cohérent** : compte de test temporaire recréé
  (`estAdmin: true`, zéro `RolePermission`, même technique que la tâche
  précédente — nécessaire car le rôle "Admin" réel reste avec son anomalie
  de 23 `RolePermission`, seul cas rendant ce chemin de code inatteignable
  autrement) → carte "Aucun accès" confirmée avec filigrane en fond, badge
  seul aligné à droite (`flex justify-end`), fond bleu et `opacity-60`
  inchangés. Compte et rôle supprimés après vérification
  (`HistoriqueEntry` de connexion supprimée avant l'utilisateur, même
  contrainte FK que la tâche précédente).
- **Rendu mobile** : vérifié par relecture de code — grille
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` inchangée, `sm:size-32`
  n'agrandit le filigrane qu'à partir du même palier `sm` que le reste du
  design system, aucun débordement horizontal possible (`overflow-hidden`
  sur le conteneur de carte).
- `tsc`/`eslint` clean, vrai `next build` réussi (65 routes générées sans
  erreur).

## Diagnostic de latence — requêtes redondantes

Deux points de redondance réseau réels trouvés par lecture directe du code
(pas de correctif hasardeux — chacun vérifié avant/après par comptage
exact des allers-retours DB) :

- **`getSession()`** (`frontend/src/lib/auth.ts`, appelée à chaque page et
  chaque Server Action authentifiée, mémoïsée par requête via `cache()`)
  faisait 3 requêtes Prisma **séquentielles** (`role`, `user`,
  `permissionDelegation`) alors qu'elles sont mutuellement indépendantes
  (`delegations` utilise `session.user.id`, déjà connu du JWT, jamais le
  résultat de `user`) — désormais un seul `Promise.all`. Réduit la latence
  de base de **tout** bouton du portail.
- **`peutEffectuerReglement`/`getResteARegler`** (`backend/src/tresorerie.ts`)
  acceptent désormais des valeurs pré-chargées optionnelles
  (`demandeConnue`/`montantValideConnu`/`totalRegleConnu`, comportement
  strictement inchangé si omis — tous les autres appelants, dont
  `reporting.ts`, ne sont pas affectés). Avant ce correctif,
  `confirmerReglementAction` déclenchait jusqu'à **3 lectures de la même
  `Demande` et 2 calculs identiques de `getTotalRegle`** pour un seul clic
  sur "Confirmer" (`peutEffectuerReglement` refetchait la demande en
  interne, puis `getResteARegler` la refetchait une deuxième fois en
  interne, puis l'action la refetchait une troisième fois explicitement) ;
  `creerReglementAction`/`modifierReglementAction` avaient le même défaut.
  Les trois actions transmettent maintenant la `demande`/le `totalRegle`
  déjà chargés — ramené à 1 lecture de la demande + 2 agrégats (le second
  agrégat n'a pas été éliminé, jugé trop risqué à dédupliquer sans
  complexifier l'API partagée pour un gain marginal).
- **`treso/finance/demandes/[id]/page.tsx`** — les 3 requêtes de la page
  (historique du dernier évènement négatif DG, catégories actives, objets
  actifs) étaient enchaînées en 2 `await` séquentiels alors
  qu'indépendantes ; regroupées en un seul `Promise.all`. Cette page héberge
  les 3 actions les plus utilisées de Finance (catégorisation, validation,
  règlement).

**Vérifié par comptage exact des allers-retours DB avant/après** (lecture
du code, pas une mesure chronométrée — une comparaison A/B chronométrée
isolée a été tentée via `git worktree` + jonction `node_modules`, mais
Turbopack refuse un `node_modules` symlinké hors de la racine détectée du
projet ; abandonné plutôt que forcer une copie complète de `node_modules`,
coûteuse en temps pour un gain de rigueur marginal face à un comptage de
requêtes déjà exact) : `confirmerReglementAction` passe de 6-8 à 3-4
allers-retours DB selon le cas (catégorisé + budget alloué ou non).

**Piste explorée, non corrigée, signalée par transparence** — chaque
Server Action mutante appelle `publishDataChanged()` (diffusion SSE) EN
PLUS de son `revalidatePath` ; or Next.js déclenche déjà un rafraîchissement
implicite de la page courante à la fin de tout appel de Server Action
(`revalidatePath` + le mécanisme natif des Server Actions). L'onglet qui
vient de cliquer reçoit donc, quelques centaines de ms plus tard, SA PROPRE
diffusion SSE (`Topbar.tsx` ne distingue pas "mon propre changement" de
"changement d'un autre utilisateur") et déclenche un second
`router.refresh()` — un second aller-retour RSC complet, systématiquement
redondant pour l'auteur de l'action. Un correctif propre nécessiterait un
identifiant de tab/session propagé du clic jusqu'à l'évènement SSE (le
Server Action s'exécute côté serveur, sans accès direct à l'onglet
appelant) — non implémenté ici : la plomberie nécessaire (id de tab par
requête Server Action) touche un mécanisme transverse à tout le portail,
jugée trop invasive pour être poussée sans mesure de production
supplémentaire. Confirmé comme structurel (pas hypothétique) par lecture du
code de `Topbar.tsx`/`eventBus.ts`, mais son impact réel sur la latence
perçue n'a pas pu être isolé chronométriquement (voir limite ci-dessus).

**Piste explorée et écartée** — le serveur `next dev` (Turbopack) compile
chaque route/Server Action à la demande : le TOUT PREMIER appel d'une
Server Action donnée dans un process de dev server coûte ~600-1400 ms,
les appels suivants de la même action quelques dizaines de ms seulement
(mesuré explicitement : catégoriser deux fois de suite sur le même écran,
1374 ms puis 37-48 ms). **Ce phénomène est spécifique à `next dev` et
disparaît entièrement dans un build de production** (`next build`
précompile tout à l'avance) — si la lenteur "en local" rapportée par
Finance a été observée contre un serveur de dev jamais redémarré depuis
longtemps ou fraîchement relancé, une bonne part de la gêne ressentie peut
venir de cet artefact de compilation à la demande, sans rapport avec le
code applicatif. À tester contre `next build && next start` pour objectiver
la latence réelle hors de cet artefact.

## Module Pointage RH — architecture et fonctionnalités complètes

> **Documentation détaillée dédiée :**
> - **Architecture technique, sécurité & scalabilité** : [docs/POINTAGE_ARCHITECTURE.md](docs/POINTAGE_ARCHITECTURE.md).
> - **Guide d'utilisation et règles fonctionnelles** : [docs/GUIDE_FONCTIONNEL_POINTAGE.md](docs/GUIDE_FONCTIONNEL_POINTAGE.md).

Module complet de gestion des temps de présence, retards, départs anticipés et absences du personnel, développé et durci par Thierry Kouame.

### 1. Modèle de données & Rôles
- **Modèles Prisma** ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)) : `Pointage` (sources `QR_CODE`, `ORDINATEUR`, `RH_EXCEPTIONNEL`, `GEOLOCALISATION`), `ParametrageHoraire` (horaires et coordonnées GPS bureau), `CorrectionPointage` (registre d'audit transparent, zéro édition silencieuse), `Absence` (`A_CONTROLER`, `CONFIRMEE`, `JUSTIFIEE`), `JourFerie` (jours chômés).
- **Permissions `pointage.*`** : 8 permissions fines réparties entre Collaborateur (`pointer`, `consulter_historique`), RH (les 8 droits complets), DG (lecture seule `/rh/presence` et reporting), et Admin (supervision).

### 2. Double barrière de sécurité & Géolocalisation
- **Contrôle réseau d'entreprise** : Filtrage IP et masques de sous-réseau CIDR (`ALLOWED_OFFICE_IPS`, `ipaddr.js`, gestion IPv4/IPv6 `::ffff:`).
- **Fallback Géolocalisation GPS (Formule de Haversine)** : Si l'agent est hors réseau Wi-Fi, calcul automatique de la distance au siège SIM Assurances (`bureauLatitude`, `bureauLongitude`, `rayonAutorise` configurable entre 30m et 200m). Filtre de précision GPS (seuil 150m max) et alerte de sécurité instantanée aux RH en cas de tentative hors périmètre.

### 3. Parcours Collaborateur & Temps Réel
- **Composant adaptatif** (`SmartPointage.tsx`) : Détection automatique du statut journalier (arrivée, départ), motif obligatoire en cas de retard (après 07h45) ou de départ anticipé (avant 16h45).
- **Pointage Mobile par QR Code** (`/pointage/qr` -> `/pointage/pointer?source=QR_CODE`) : Scan sécurisé à l'accueil de l'entreprise.
- **Synchronisation Server-Sent Events (SSE)** (`/api/pointage/stream`) : Tout pointage actualise instantanément les compteurs et listes des tableaux de bord RH sans rechargement.

### 4. Automatisation des Absences & Oublis (CRON)
- **Route planifiée** (`/api/cron/absences`) sécurisée par `CRON_SECRET`.
- **Règles d'équité** : Exclusion stricte des week-ends et des jours fériés (`JourFerie`).
- **Protection de l'ancienneté (Option B)** : Aucune absence ne peut être imputée avant ou le jour même de la date de création ou de réactivation du compte collaborateur.
- **Détection des oublis de départ** : Alerte prioritaire envoyée à l'employé et aux RH si l'arrivée a été pointée sans départ après le délai configurable (`delaiAlerteOubliDepartMinutes`).
- **Rattrapage manuel** : Action `recoverAbsencesAction` disponible depuis l'interface RH.

### 5. Boîte à Outils RH
- Présence du jour en direct (`/pointage/rh/presence`), pointage exceptionnel avec régularisation automatique (`/pointage/rh/pointages/nouveau`), corrections tracées (`/pointage/rh/corrections`), traitement des absences (`/pointage/rh/absences`), configuration horaires et GPS (`/pointage/rh/horaires`, `/pointage/rh/geolocalisation`), et reporting Excel multi-feuilles aux couleurs SIM Assurances (`/pointage/rh/reporting`, `exceljs`).

### 6. Chantiers Transverses Réalisés Hors Pointage
- **Plateforme de Notifications Multi-Canal** : Moteur unifié à 3 niveaux de priorité (`CRITIQUE`, `IMPORTANT`, `INFO`), intégration Firebase Cloud Messaging (Web Push) multi-terminaux avec auto-nettoyage des tokens, tiroir latéral (`NotificationDrawer.tsx`), alertes audio Web Audio API.
- **Console Admin — Adoption Push** : Supervision sous `/admin/notifications` avec analyse des navigateurs/OS et export CSV.
- **Charte Emails & Compatibilité Outlook** : Gabarits tabulaires responsives, police Calibri universelle, logo CID embarqué, notifications de statut de compte.
- **Réinitialisation de Mot de Passe par Email** : Parcours sécurisé `/forgot-password` et `/reset-password/[token]` avec jeton 1h et hachage bcrypt.
- **Refonte Profil & Audit** : Vues de profil personnalisées par rôle (`/profil`), élimination des waterfalls de rendu dans `LogsList.tsx` et traçabilité des services.
- **Durcissement FeedbackApp** : Exclusion du rôle technique Admin des destinataires de feedback (`peutRecevoirFeedback: false`), modération RH/DG, système de notation structurée.

## Module FeedbackApp — anonymat total

Troisième module : permet à QUICONQUE (employé connecté ou visiteur sans
compte) de laisser un message constructif anonyme sur un employé nommé du
portail. **Tranche A seulement implémentée à ce stade** : page publique de
soumission (`/feedback/nouveau`) et de consultation (`/feedback`), sans
compte. La soumission par un employé déjà connecté (`source: INTERNAL`)
est prévue mais pas encore construite (colonne déjà en place pour éviter
une migration supplémentaire).

### Règle absolue : anonymat structurel de l'auteur

**Aucune donnée permettant d'identifier l'auteur d'un message ne doit
JAMAIS être stockée, ni même transiter dans un log serveur.** Cette règle
prime sur tout le reste du module et a été vérifiée à chaque étape,
au-delà de la simple relecture de code :

- **Modèle `Feedback`** (`backend/prisma/schema.prisma`) — colonnes :
  `id`, `content`, `recipientId`, `source`, `submittedAt`, `isModerated`,
  `motifModeration`, `moderatedById`/`moderatedAt` (traçabilité de
  l'ACTION DE MODÉRATION elle-même, RH/DG — sans rapport avec l'auteur du
  message). **Aucune colonne** `authorId`/`authorIp`/`authorSession` ni
  équivalent, sous aucune forme.
- **`submittedAt` est une colonne SQL `DATE`** (`@db.Date`, jamais
  `TIMESTAMP`) — garantie posée au niveau du **schéma**, pas seulement par
  convention applicative : aucune heure/minute/seconde n'est
  physiquement stockable, même par erreur d'un futur appelant. Vérifié en
  base après une soumission réelle : `submittedAt` vaut exactement
  `AAAA-MM-JJT00:00:00.000Z` et `information_schema.columns` confirme
  `data_type: "date"` (pas `timestamp`).
- **Aucun cookie posé pour un visiteur anonyme** — `/feedback` et
  `/feedback/nouveau` sont exclus du **`matcher`** de `frontend/src/proxy.ts`
  lui-même (pas seulement autorisés dans le callback `authorized` de
  `auth.config.ts`). Un chemin simplement "autorisé" par `authorized`
  passe quand même par le wrapper `NextAuth(...).auth`, qui pose ses
  propres cookies (`authjs.csrf-token`, `authjs.callback-url`) sur
  **toute** requête qu'il traite, y compris une requête finalement
  autorisée — **constaté empiriquement** lors de la construction de ce
  module (`Set-Cookie` présent malgré `authorized` renvoyant `true`).
  Seule l'exclusion du matcher empêche réellement le middleware de
  s'exécuter. Vérifié par inspection réseau réelle (pas supposée) : GET
  et POST (soumission) sur les deux routes renvoient zéro `Set-Cookie`,
  alors que `/login` et toute route protégée (ex: `/pointage/pointer`)
  continuent d'en recevoir normalement. Ancré avec `$` dans le matcher
  (pas de préfixe libre) pour ne jamais lever l'authentification d'une
  future route interne du module, ex: `/feedback/interne` (Tranche B).
- **Aucune IP journalisée** — `soumettreFeedbackAction`
  (`frontend/src/app/feedback/nouveau/actions.ts`) est la seule fonction
  du module à lire une IP (`getClientIp`, `backend/src/pointage-utils.ts`),
  utilisée **uniquement** comme clé d'un compteur anti-spam **en
  mémoire** (`checkRateLimit`, voir plus bas) — jamais écrite en base, ni
  passée à `console.log`, ni au logger d'audit persistant du projet.
  Vérification exhaustive faite par grep projet entier : le portail a une
  fonction `logAuditAction` (`frontend/src/lib/auditLog.ts`) qui, elle,
  persiste bien l'IP en base (utilisée par login, pointage, actions admin
  users/services, profil) — confirmé que `soumettreFeedbackAction` ne
  l'appelle **jamais** (seule mention : un commentaire expliquant pourquoi).
  Confirmé aussi qu'aucun mécanisme de journalisation globale
  (`instrumentation.ts`, middleware générique, `morgan`/`pino`/`winston`)
  n'existe dans le projet — le seul log qui existe sur cette route est le
  log natif `next dev` (méthode + chemin + statut + timing), qui ne
  contient jamais d'adresse IP.

### Anti-spam en mémoire — limite mono-instance documentée

**`checkRateLimit`** (`frontend/src/lib/rate-limit.ts`, `Map` en mémoire du
process, déjà utilisé par `/login`) — 3 soumissions / 5 minutes par IP,
l'IP servant uniquement de clé de compteur transitoire (jamais persistée).
Vérifié en pratique : la 4ᵉ soumission valide consécutive est bloquée,
sans écriture en base. **Limite connue et acceptée pour cette V1** : ce
compteur est en mémoire d'un seul process — un déploiement multi-instance
(scaling horizontal) ne partagerait pas ce compteur entre conteneurs,
même limite déjà documentée pour le bus SSE (voir "Rafraîchissement en
temps réel"). À revoir (ex: Redis) si l'infrastructure de déploiement
change un jour.

### Anti-bot : honeypot (pas de CAPTCHA tiers pour cette V1)

Champ caché `site_web` (`FeedbackForm.tsx`), invisible et hors du flux de
tabulation pour un humain — un bot qui le remplit reçoit un **faux succès
silencieux** (même message que "Merci, votre message a bien été envoyé."),
sans jamais révéler la détection, et **aucune écriture en base** (vérifié
en pratique). Choix V1 volontairement simple plutôt qu'un vrai CAPTCHA
tiers (Turnstile/hCaptcha) — à renforcer si le spam devient un problème
réel en production.

### Filtre anti-haine et validation de contenu

`backend/src/feedback-constants.ts` (voir plus bas pourquoi ce fichier est
séparé de `feedback.ts`) : `FEEDBACK_CONTENT_MIN`/`MAX` (20-500
caractères, revalidés côté serveur par zod, aucune contrainte de longueur
au niveau SQL), `FEEDBACK_BANNED_WORDS` (liste française simple,
comparaison insensible casse/accents, facilement extensible — pas de
service tiers ni de modèle IA pour cette V1), `containsUrl` (rejette toute
URL/lien détectable). Les trois vérifiées en pratique par requête réseau
directe (message trop court, trop long, contenant un lien, contenant un
mot banni → tous rejetés avec un message précis).

### Permission `feedback.moderer`

Nouvelle permission dédiée, **jamais héritée automatiquement du bypass
`estAdmin`** (même principe que toutes les permissions `treso.*`/
`pointage.*`) — attribuée dans le seed aux rôles **RH et DG** (décision
confirmée : la Direction modère aussi, au même titre que RH), **jamais à
Admin**. Vérifiée en base : la permission est assignée aux deux rôles, à
aucun autre. Vérifiée aussi **en pratique** via une vraie connexion (compte
DG réel, JWT réel, `getSession()` réel avec sa jointure Prisma
rôle→permissions) : `session.permissions` contient bien `feedback.moderer`
pour ce compte — c'est exactement le tableau que `hasPermission()`
consulte partout où l'écran de modération le vérifie (voir "Module
FeedbackApp — Tranche B" plus bas). Aucune autre logique du projet ne
suppose que seul RH la possède : seul `seed.ts` référence cette clé en
dur, aucun composant/action ne compare `role.name === "RH"` pour ce module.

**Régression trouvée puis corrigée (voir "Module FeedbackApp — Tranche B —
régression `ensureFeedbackPermissions()`" plus bas)** : un mécanisme
runtime ajouté en Tranche B réattribuait automatiquement cette permission
à RH/DG **et Admin** à chaque redémarrage de process, écrasant toute
révocation Admin — corrigé, `Admin` n'y a plus jamais accès sauf choix
manuel explicite d'un Admin via `/admin/roles`.

### Décisions confirmées

- **Destinataires proposables** (`getFeedbackRecipients`,
  `backend/src/feedback.ts`) : **tous** les `User` actifs du portail dont
  le rôle est éligible (`role.peutRecevoirFeedback`, voir ci-dessous) —
  confirmé, ne pas restreindre par rôle métier au-delà de ça.
- **Destinataire jamais affiché publiquement** (`getPublicFeedbacks`) : la
  vue publique (`/feedback`) ne montre que le contenu et la date (arrondie
  au jour) des messages `source: PUBLIC` non modérés — confirmé, ne pas
  changer.

### `Role.peutRecevoirFeedback` — exclure les comptes techniques

Un rôle "Admin" représente un **compte technique**, pas un vrai employé à
évaluer : ses comptes ne doivent jamais apparaître comme destinataires sur
`/feedback/nouveau`. Un rôle combiné comme "Admin / Collaborateur" (qui
porte aussi `estAdmin: true` mais représente, lui, un vrai employé) doit en
revanche rester proposable — **jamais de comparaison sur le nom du rôle en
dur** (`role.name === "Admin"`), même principe que `estAdmin`/
`peutEtreBeneficiaireDelegation` : un champ dédié sur `Role`.

- **`Role.peutRecevoirFeedback`** (`Boolean @default(true)`) — migration
  additive (`20260915145338_role_peut_recevoir_feedback`) suivie d'une
  migration de rattrapage dédiée
  (`20260915145339_role_admin_peut_recevoir_feedback_rattrapage`, même
  esprit que `20260911090822_role_collaborateur_beneficiaire_delegation_rattrapage`)
  qui met ce champ à `false` **uniquement** pour le rôle nommé exactement
  "Admin" sur les bases déjà seedées, où la nouvelle colonne apparaît sinon
  à `true` pour tout le monde. `seed.ts` crée aussi directement le rôle
  "Admin" avec `peutRecevoirFeedback: false`, donc une base neuve n'a pas
  besoin de la migration de rattrapage pour être correcte.
- **`getFeedbackRecipients`** filtre désormais avec
  `where: { isActive: true, role: { peutRecevoirFeedback: true } }`.
- **Librement modifiable à tout moment** depuis `/admin/roles`
  (`PeutRecevoirFeedbackToggle.tsx` /
  `toggleRolePeutRecevoirFeedbackAction`, `admin/roles/actions.ts`) — même
  principe que `peutEtreBeneficiaireDelegation` : ce n'est pas un invariant
  de sécurité critique comme `estAdmin` (jamais figé), aucun risque de
  verrouillage à protéger. Chaque changement est historisé
  (`HistoriqueEntry`, actions `GRANT_RECEVOIR_FEEDBACK`/
  `REVOKE_RECEVOIR_FEEDBACK`).
- **Vérifié en pratique** (comptes de test réels, requêtes réseau réelles,
  pas seulement en base) : le compte "Admin Test" a disparu de la liste
  des destinataires sur `/feedback/nouveau` ; un compte de test temporaire
  sous le rôle "Admin / Collaborateur" (déjà présent en base sans compte
  assigné, voir "Anomalie connue" plus haut) y reste bien proposable ;
  Finance/RH/DG/Collaborateur restent proposables normalement ; et la
  bascule Admin elle-même a été testée via une vraie connexion Admin et un
  vrai appel de `toggleRolePeutRecevoirFeedbackAction` (protocole Server
  Action réel, pas une écriture DB directe) — Finance a bien disparu puis
  réapparu de la liste après avoir retiré puis rendu l'éligibilité.

### Coexistence avec le flux mot de passe oublié (Thierry)

`frontend/src/lib/auth.config.ts` est partagé entre l'exclusion FeedbackApp
et le flux mot de passe oublié/réinitialisation de Thierry
(`/forgot-password`, `/reset-password`) — **vérifié que les deux
coexistent sans que l'un écrase l'autre**, aucune correction nécessaire :
les deux logiques ne se recouvrent sur aucun chemin (le matcher de
`proxy.ts` exclut uniquement `feedback$`/`feedback/nouveau$` ; `isAuthRoute`
dans `authorized()`, lui, couvre `/login`/`/invitation`/`/forgot-password`/
`/reset-password` — deux mécanismes disjoints, sur des routes disjointes,
dans le même fichier sans interférence). Testé de bout en bout après la
fusion : soumission réelle de `/forgot-password` → email simulé en
console (aucun SMTP configuré dans `.env`, mode simulation sans risque
d'envoi réel) avec lien de réinitialisation → `/reset-password/<token>`
répond 200. `nodemailer`/`@types/nodemailer` (ajoutés par Thierry dans
`frontend/package.json`) n'étaient pas installés après la fusion
(`node_modules` non régénéré) — `npm install` exécuté pour corriger,
resolu depuis le cache local sans accès réseau ; sans rapport avec
`auth.config.ts`/`proxy.ts`, mais nécessaire pour tester réellement ce
flux.

### Module FeedbackApp — Tranche B (fusion Thierry : Admin + User)

La Tranche B (espace Collaborateur "Mes critiques reçues", espace de
modération RH/DG, export CSV) a été fusionnée sans conflit Git, mais a
touché plusieurs zones sensibles d'un coup (`auth.ts`, `permissions.ts`,
les trois toggles de `/admin/roles`). Diagnostic complet fait avant toute
correction, puis une régression corrigée — détail ci-dessous.

**Code mort trouvé et nettoyé** — deux dossiers distincts existaient pour
l'admin FeedbackApp : `frontend/src/app/(dashboard)/admin/feedbacks/` et
`frontend/src/app/(dashboard)/feedback/admin/`. Le second est le vrai
(référencé par `nav.ts`, implémentation complète, gardé côté serveur dans
son `layout.tsx` ET son `page.tsx`, indépendamment l'un de l'autre — même
convention que partout ailleurs : jamais un layout comme seule garde). Le
premier était un mélange : son `page.tsx` est une **redirection
fonctionnelle** vers `/feedback/admin` (préserve les query params — gardée
telle quelle, probable compatibilité descendante pour d'anciens liens,
pas du code mort) ; ses 4 autres fichiers (`AdminFeedbackTable.tsx`,
`FeedbackFilters.tsx`, `ModererFeedbackDialog.tsx`, `actions.ts` — ce
dernier exportait littéralement une fonction nommée `unused()`) étaient
sans ambiguïté du code mort, jamais importés nulle part : supprimés.
Point mineur signalé, non corrigé (hors périmètre) : `MES_FEEDBACKS_ITEM`/
`MODERATION_FEEDBACK_ITEM` (`nav.ts`) sont des exports jamais utilisés,
dupliquant sans risque les items inline de la branche `feedback` réelle.

**Séparation `client-safe.ts`/`feedback-constants.ts` : aucune régression**
— vérifié qu'un vrai `next build` passe intégralement (65 routes, aucune
erreur "Module not found"), et que `feedback-constants.ts` n'a toujours
aucun import Prisma. Les ajouts de Thierry (`getUserFeedbacks`,
`getAdminFeedbacks`, `getFeedbackStats`, `modererFeedback`) vivent tous
dans `feedback.ts` (le fichier Prisma-dépendant), jamais réexportés côté
client.

**Permissions `treso.valider_demande`/`treso.effectuer_reglement`/plafond
de délégation : aucune régression**, vérifié en pratique (pas seulement
par lecture de code, `hasPermission()`/`accorderDelegationAction` n'ont
d'ailleurs pas été touchés par cette fusion) : RH refusé sur
`/treso/finance`, DG et Finance admis (guard OR de
`treso/finance/layout.tsx` intacte) ; Finance délègue
`treso.effectuer_reglement` à un Collaborateur → apparaît dans
`session.permissions` du bénéficiaire mais jamais dans
`session.rolePermissions` → tentative de re-délégation en cascade par ce
même Collaborateur refusée avec le message attendu
(`verifierEligibiliteDonneur`, `delegations/actions.ts`, inchangé).

**Anonymat sur les nouveaux écrans Tranche B : confirmé, aucune fuite** —
`getUserFeedbacks(userId)` filtre strictement `recipientId: userId`,
vérifié avec deux comptes de test réels (Collaborateur/RH) : isolation
croisée parfaite, zéro contamination. `/feedback/admin` et
`/api/feedback/export` : gardés **côté serveur** (307/403/401 testés par
requête réseau directe avec un compte sans `feedback.moderer`, et sans
session du tout), jamais un masquage UI seul. `getAdminFeedbacks`
pseudonymise le **destinataire** (`recipientPseudo`, dérivé de
`recipientId` — ex: "Collaborateur #4CHY") sur la liste globale de
modération, conformément au CDC de Thierry ; ceci concerne l'anonymat du
DESTINATAIRE dans cet écran-là (un choix distinct de la règle absolue sur
l'AUTEUR) — le champ structuré ne contient jamais le vrai nom, vérifié
sur la charge utile RSC brute.

### Régression `ensureFeedbackPermissions()` — réattribution automatique à chaque process

**Trouvée** : `ensureFeedbackPermissions()` (`backend/src/feedback.ts`,
ajoutée en Tranche B) faisait un `upsert` avec `update: {}` sur
`RolePermission` pour RH, DG **et Admin**, appelée SANS CONDITION à
l'intérieur de `getSession()` — donc à chaque page/Server Action
authentifiée, y compris au tout premier appel suivant chaque redémarrage
de process serveur (le singleton en mémoire `feedbackPermissionsSyncPromise`
ne protégeait que des appels répétés PENDANT la vie d'un même process, pas
entre deux démarrages). Conséquence directe, **constatée empiriquement** :
un Admin qui révoque `feedback.moderer` d'un rôle via `/admin/roles` voit
ce choix silencieusement annulé dès le redémarrage/redéploiement suivant,
par la simple connexion d'un utilisateur quelconque sans aucun rapport —
et "Admin" n'a jamais été autorisé à recevoir cette permission
automatiquement (seuls RH/DG l'ont été, décision explicite antérieure).
Un second point d'appel identique existait aussi dans
`admin/roles/page.tsx` (même fonction, même singleton partagé).

**Corrigé** — séparation stricte entre "garantir que la permission existe"
(sûr, automatique, jamais destructeur) et "décider qui la possède" (doit
rester un choix fait une seule fois, puis librement modifiable) :

- **`ensureFeedbackModuleAndPermission()`** (renommée, `feedback.ts`) —
  ne fait plus qu'`upsert` le Module `feedback` et la Permission
  `feedback.moderer` eux-mêmes, **plus aucun `RolePermission` créé ou
  modifié ici**. Reste sûre à appeler à chaque process (utile en dev après
  un `git pull` sans reseed) : n'écrase jamais un choix Admin, puisqu'elle
  ne touche plus jamais l'attribution. Appelée depuis `getSession()`
  (`frontend/src/lib/auth.ts`) et `admin/roles/page.tsx`, les deux mêmes
  points qu'avant.
- **Attribution initiale à RH/DG : migration de rattrapage ponctuelle**
  (`20260918000000_feedback_moderer_role_permission_rattrapage`), même
  esprit que les rattrapages `estAdmin`/`peutEtreBeneficiaireDelegation`/
  `peutRecevoirFeedback` déjà documentés — s'exécute UNE SEULE FOIS pour
  la durée de vie d'une base (garanti par `_prisma_migrations`, jamais
  rejouée à un redémarrage suivant), donc n'écrase jamais une décision
  Admin ultérieure. Idempotente de bout en bout
  (`ON CONFLICT DO NOTHING`) : crée le Module/la Permission s'ils
  n'existent pas encore, attribue `feedback.moderer` à RH et DG s'ils ne
  l'ont pas déjà, et **retire explicitement cette permission du rôle
  "Admin"** si l'ancien mécanisme l'y avait déjà silencieusement placée
  sur cette base (jamais un choix Admin délibéré — case jamais cochée à la
  main pour son propre rôle, uniquement l'effet du bug) ; sans effet sur
  une base neuve, où `seed.ts` fait déjà tout correctement seul (RH+DG,
  jamais Admin).

**Vérifications, redémarrage de process réel (pas seulement rechargement
de page)** :
- Admin révoque `feedback.moderer` de RH via `/admin/roles` (vraie
  requête réseau, protocole Server Action réel) → **reste révoqué après 3
  redémarrages complets du serveur successifs**, chacun suivi d'une
  connexion réelle d'un compte sans rapport (Finance) qui déclenche
  `getSession()`, et d'un chargement de `/admin/roles` (l'autre point
  d'appel) — confirmé en base à chaque fois : RH absent de la liste des
  rôles attribués tant que non re-coché manuellement.
- **Admin n'a jamais `feedback.moderer` après ces 3 redémarrages** —
  confirmé, aucune réapparition automatique.
- **Environnement neuf** : base de test jetable créée localement,
  `prisma migrate deploy` (36 migrations, y compris la nouvelle) puis
  `seed.ts` exécutés from scratch, sans aucune intervention manuelle →
  RH et DG ont `feedback.moderer`, Admin non — vérifié directement en
  base sur cette base jetable, puis supprimée.
- État final de la base de dev partagée : RH et DG ont `feedback.moderer`
  (restauré à l'identique de l'état voulu après les tests de révocation),
  Admin ne l'a plus.

### Piège rencontré — `client-safe.ts` et un re-export nommé

`backend/src/client-safe.ts` doit rester importable par un Client
Component sans jamais entraîner Prisma/`pg` dans le bundle navigateur
(voir "Monorepo backend/frontend"). Un premier essai faisait
`export { FEEDBACK_CONTENT_MIN, FEEDBACK_CONTENT_MAX } from "./feedback"`
— un re-export **nommé** (pas `export *`), en pensant que ça évitait le
problème. **Constaté en pratique que non** : `next dev` échouait avec
`Module not found: Can't resolve 'dns'` (`pg` → `dns`), car même un
re-export nommé force le bundler à évaluer le module source en entier, et
`feedback.ts` importe `./prisma` en tête de fichier pour ses fonctions de
lecture (`getFeedbackRecipients`, `getPublicFeedbacks`). **Solution** :
les constantes/validations sans aucune dépendance Prisma
(`FEEDBACK_CONTENT_MIN`/`MAX`, `FEEDBACK_BANNED_WORDS`,
`containsBannedContent`, `containsUrl`) vivent maintenant dans
`backend/src/feedback-constants.ts`, un fichier qui n'importe jamais
`./prisma` — `feedback.ts` les réexporte (`export *`) pour le code
backend, `client-safe.ts` importe directement `feedback-constants.ts`,
jamais `feedback.ts`. Seule protection fiable constatée : isoler
physiquement dans un fichier séparé tout ce qui doit rester sûr pour le
navigateur, pas une forme d'export particulière.

### FeedbackApp — notation structurée (refonte majeure)

Refonte confirmée par le maître de stage : la soumission en texte libre
est **entièrement retirée** au profit d'un questionnaire structuré
(étoiles, curseurs, choix multiples) — plus aucun champ où l'utilisateur
tape du texte. Le `content` final (toujours 20-500 caractères, colonne et
contrainte inchangées) est **généré côté serveur** à partir des réponses,
jamais saisi : élimine tout risque d'identification par style d'écriture,
et empêche structurellement qu'un client malveillant (rejeu réseau direct)
n'injecte un texte arbitraire — `soumettreFeedbackAction` ne lit d'ailleurs
plus jamais de champ `content` dans `formData`.

**Modèle de données** (migration `20260918010000_feedback_structured_ratings`) :

- **`FeedbackType`** (`COLLABORATION` | `CONDITIONS_TRAVAIL`) —
  `Feedback.type`, `@default(COLLABORATION)` pour que les lignes
  existantes restent valides sans migration de données destructrice.
  Détermine la VISIBILITÉ (voir plus bas), orthogonal à `FeedbackSource`
  (qui reste "qui a soumis", jamais mélangé avec "quel type d'avis").
- **`Feedback.recipientId`** devenu nullable (`String?`) — obligatoire
  pour `COLLABORATION`, toujours `null` pour `CONDITIONS_TRAVAIL` (avis
  sur l'entreprise en général, aucun destinataire). Revalidé côté serveur
  selon `type` à chaque écriture (`createFeedback`, `feedback.ts`), jamais
  une simple convention. Effet de bord à noter : la relation passe donc en
  `onDelete: SetNull` (comportement par défaut de Prisma pour une relation
  optionnelle) — supprimer un `User` ayant reçu des avis ne bloque plus au
  niveau base, ses `Feedback.recipientId` deviennent `null` ; hors
  périmètre de cette tâche, `supprimerUtilisateurAction` n'a pas été
  auditée pour ce cas précis.
- **`Feedback.ratings`** (`Json?`) — réponses brutes structurées (clé de
  question → note ou code de choix), en complément de `content`, pour des
  statistiques agrégées futures. RÈGLE ABSOLUE inchangée : ces clés/valeurs
  ne portent jamais, même indirectement, de donnée permettant de
  reconstituer l'auteur — uniquement des notes/choix sur des questions
  FIXES, jamais un identifiant, une IP, un texte libre.
- Aucun changement à `submittedAt` (`@db.Date`), aux vérifications de
  cookie/IP/honeypot déjà en place — toutes revérifiées après cette
  refonte, aucune régression (voir "Vérifications" plus bas).

**Questions et structure** (`backend/src/feedback-questions.ts`, fichier
PUR sans dépendance Prisma — mêmes règles que `feedback-constants.ts`,
importe seulement le type `FeedbackType` généré, sûr par construction) —
libellés reproduits au mot près depuis les maquettes fournies :

- **Onglet "Collaboration entre collègues"** (`COLLABORATION_QUESTIONS`,
  pas d'étapes) : 6 questions à 5 étoiles (qualité du travail,
  communication, esprit d'équipe, ambiance, disponibilité, respect des
  délais) + 1 note globale sur une échelle 1-10.
- **Onglet "Conditions de travail"** (`CONDITIONS_TRAVAIL_STEPS`, 4
  étapes avec indicateur de progression) : Environnement de travail (2
  choix + 1 curseur 1-5), Management (2 choix + 1 curseur), Motivation &
  ambiance (1 curseur + 2 choix), Satisfaction globale (1 curseur + 1
  choix) — 11 questions au total.
- **Toutes les questions d'un type sont obligatoires** (`validateFeedbackRatings`)
  — formulaire fermé, jamais de soumission partielle : simplifie la
  génération du commentaire (aucun cas de réponse manquante à gérer en
  dehors d'un rejet explicite).

**⚠️ Génération du commentaire — CONTENU PROVISOIRE, à valider par le
maître de stage avant mise en production** (`generateFeedbackComment`,
`backend/src/feedback-questions.ts`) :

- Pour chaque question à étoiles/curseur (1-5) : note ≥4 → phrase positive
  pré-écrite spécifique à la question ; note = 3 → phrase neutre ; note
  ≤2 → phrase constructive (jamais punitive). Note globale 1-10
  (collaboration) : ≥8 positif, 5-7 correct, ≤4 point d'attention.
  Questions à choix : chaque option a sa propre phrase pré-écrite.
- **Sélection des phrases assemblées** : chaque réponse reçoit un poids de
  significativité (écart à la valeur médiane pour une échelle, position
  extrême vs. centrale pour un choix) ; les 3 réponses les plus
  significatives sont assemblées par défaut (ajusté entre 2 et 4 phrases
  pour respecter strictement 20-500 caractères), jamais une liste à puces
  — un paragraphe naturel. Ordre déterministe (à poids égal, l'ordre des
  questions fait foi) : mêmes notes → même texte, utile pour la
  validation.
- Toutes les phrases sont neutres et professionnelles, y compris pour les
  notes basses — objectif constructif, jamais agressif ni punitif.
- **Exemples générés, à faire valider** (voir aussi le résumé de la
  tâche) :
  - Collaboration, notes hautes : *"La qualité du travail réalisé avec ce
    collaborateur est jugée très satisfaisante. Cette personne communique
    de manière claire et efficace. Cette personne contribue positivement
    à l'ambiance de travail."* (201 caractères)
  - Conditions de travail, réponses négatives : *"Les outils nécessaires
    pour bien travailler font défaut. La charge de travail est jugée
    excessive. L'environnement de travail pourrait être amélioré."* (149
    caractères)
  - Conditions de travail, mélange réaliste : *"Un sentiment d'écoute est
    ressenti lors de l'expression d'une préoccupation. SIM Assurances
    serait recommandée comme lieu de travail. Les outils disponibles pour
    travailler ne couvrent que partiellement les besoins."* (215
    caractères)
- Vérifié sur 6 combinaisons de notes (hautes/basses/mélange × les deux
  types) : toujours entre 149 et 215 caractères en pratique, largement
  dans les bornes 20-500 (garanti par construction avec les phrases
  actuelles ; filets de sécurité en fin de fonction — troncature ou ajout
  d'une phrase de secours — jamais déclenchés en pratique, gardés par
  défense en profondeur).

**Visibilité par `type`** — changement de comportement important :

- **`COLLABORATION` : privé.** Visible uniquement par le destinataire
  (`getUserFeedbacks`, filtré `recipientId: userId` ET `type:
  COLLABORATION`) et par les comptes `feedback.moderer` (`getAdminFeedbacks`,
  sans filtre de type par défaut). **Les critiques sur un collègue, qui
  étaient publiques avant cette tâche (`source: PUBLIC`), sont désormais
  strictement privées.**
- **`CONDITIONS_TRAVAIL` : public.** `getPublicFeedbacks` (`/feedback`)
  filtre désormais sur **`type: CONDITIONS_TRAVAIL`, plus jamais sur
  `source`** : la visibilité publique dépend de la nature de l'avis, pas
  de qui l'a soumis (un avis `CONDITIONS_TRAVAIL` d'un employé connecté,
  `source: INTERNAL`, est tout aussi public qu'un avis anonyme).
- **`getAdminFeedbacks`** (écran de modération) renvoie toujours les
  **deux types sans filtre par défaut** (un filtre `type` optionnel existe
  dans `AdminFeedbackFilters` pour un usage futur côté UI) — colonne
  "Type" ajoutée à `AdminFeedbackTable.tsx` pour les distinguer visuellement.
  `recipientPseudo` devient `null` pour `CONDITIONS_TRAVAIL` (pas de
  destinataire à pseudonymiser) — corrige au passage un plantage potentiel
  (`recipientId.replace(...)` sur `null`) introduit par la nullabilité du
  champ.

**Vérifications, comptes de test réels + rejeux réseau** :
- Un avis `COLLABORATION` de test (soumis via le protocole Server Action
  réel) n'apparaît **jamais** sur `/feedback`, même en requête directe non
  authentifiée — confirmé (0 occurrence).
- Un avis `CONDITIONS_TRAVAIL` de test apparaît publiquement sans
  authentification, zéro cookie — confirmé.
- Le destinataire (compte de test réel) voit son `COLLABORATION` dans
  "Mes critiques reçues" ; un autre collaborateur connecté ne le voit
  jamais — confirmé avec deux comptes réels.
- Admin, DG et RH voient chacun les **deux types** dans l'historique de
  modération — testé séparément pour les 3 rôles (connexion réelle
  chacun), confirmé. Un compte sans `feedback.moderer` reste refusé
  (307 vers `/?error=acces_refuse_moderation`).
- Réponses incomplètes rejetées côté serveur avec un message précis
  (testé par rejeu réseau direct, contournant le formulaire).
- Honeypot et rate limiting revérifiés fonctionnels avec le nouveau
  formulaire (mêmes mécanismes, inchangés).
- **Aucune régression de bundle** : `feedback-questions.ts` n'importe que
  `./feedback-constants` et le type `FeedbackType` généré (sûr) — jamais
  `./prisma`. Un vrai `next build` passe intégralement (65 routes, aucune
  erreur "Module not found").

### `feedback.moderer` accordé à Admin — décision délibérée (pas l'incident précédent)

**Confirmé par le maître de stage le 17/09/2026** (à corriger si la date
réelle diffère) : contrairement à l'incident précédent (réattribution
AUTOMATIQUE à chaque redémarrage de process, corrigée — voir plus haut),
cette fois Admin reçoit `feedback.moderer` par un **choix produit
explicite et documenté**, appliqué UNE SEULE FOIS :

- Migration ponctuelle dédiée
  (`20260918010001_feedback_moderer_admin_rattrapage`, `INSERT ... ON
  CONFLICT DO NOTHING`) pour les bases existantes.
- `seed.ts` : `[roleAdmin.id]: ["feedback.moderer"]` — **exception
  délibérée** à l'invariant documenté "le rôle Admin n'a aucune
  `RolePermission` explicite" (voir "estAdmin — accès à la console
  /admin" plus bas). Seule exception à ce jour : ne pas y ajouter d'autres
  permissions `treso.*`/`pointage.*` sans une décision tout aussi
  explicite et sourcée.
- Reste ensuite **librement modifiable** par un Admin via `/admin/roles`,
  comme n'importe quel autre rôle — jamais réinitialisé automatiquement
  (le mécanisme runtime qui faisait ça a été retiré, voir "Régression
  `ensureFeedbackPermissions()`" plus haut).
- Vérifié en pratique : connexion réelle en Admin, accès à
  `/feedback/admin` réussi, les deux types de feedback visibles dans
  l'historique.

### FeedbackApp — refonte visuelle de la soumission

Refonte du RENDU de la page de soumission (structure/contenu des
questions inchangés au mot près) — objectif un résultat soigné et
professionnel, pas une copie du visuel basique des maquettes de
référence. Skill `frontend-design` (`/mnt/skills/public/frontend-design/
SKILL.md`) demandée en préalable : **chemin inexistant sur cet
environnement** (convention de conteneur Unix, absente de cette
installation Windows/VSCode) — appliqué à la place les principes déjà
établis et documentés dans ce projet (`FinanceActionCard.tsx`,
`BrandBackdrop.tsx`, palette/ombres/animations de `globals.css`), signalé
explicitement plutôt que silencieusement ignoré.

**IA repensée** : `/feedback/nouveau` (formulaire seul) et `/feedback`
(hub ou liste publique selon connexion, apporté par Thierry) fusionnent en
UNE seule page — hero, réassurance, formulaire (les deux onglets) et liste
publique cohabitent désormais sur `/feedback`, pour visiteur anonyme ET
employé connecté. `/feedback/nouveau` devient une redirection vers
`/feedback#soumettre-un-feedback` (ancre directe sur la section de
soumission, jamais un simple retrait de route — même principe que la
redirection déjà en place pour `/admin/feedbacks`). Les liens rapides
"Mes critiques reçues"/"Modération" du Hub de Thierry sont conservés
(affichés en haut si le compte est éligible) mais réduits à une rangée de
liens secondaires — ils n'occupent plus toute la page.

**Fichiers déplacés** : `StarRating.tsx`/`RatingSlider.tsx`/
`ChoiceButtons.tsx`/`NumberScale.tsx`/`FeedbackForm.tsx`/`actions.ts`
vivent maintenant sous `frontend/src/app/feedback/` (plus `.../nouveau/`)
— convention du projet (colocalisation à la page qui les utilise
réellement).

**Traitement visuel par écran** :

- **Hero** (`FeedbackHero`, `feedback/page.tsx`) — dégradé confiné au
  bandeau lui-même (`.feedback-hero-bg`, `globals.css` : radial + linéaire
  dans les bleus de marque), jamais le fond de la page entière (voir
  `BrandBackdrop.tsx` : "premier essai [dégradé bleu pleine page] refusé
  explicitement" — un dégradé contenu à un bandeau reste une application
  bien plus étroite que ce refus documenté, principe général "jamais un
  aplat dominant en fond de PAGE" respecté). Texture de marque : le
  triangle du pictogramme (`BRAND_ICON_PATHS`, déjà utilisé par
  `BrandBackdrop`/`Sidebar`) en grand format, très pâle, coin haut-droit —
  jamais un nouveau motif décoratif inventé. Titre en deux tons (blanc +
  bleu clair de marque), hiérarchie typographique marquée (`text-3xl
  font-black` → corps `text-sm`).
- **3 cartes de réassurance** (`ReassuranceCard`) — même pattern que
  `FinanceActionCard.tsx` : badge d'icône teinté (`bg-{tone}-bg text-{tone}`),
  jamais un emoji brut. Anonyme (`lock`, primary), Constructif
  (`trending-up`, success), Sécurisé (`shield-check`, info). Survol :
  élévation + translation verticale légère (`.card-shadow-hover`,
  `motion-safe:hover:-translate-y-0.5`), identique au reste du portail.
- **Étoiles** (`StarRating.tsx`) — icône `star` (nouvelle, `icons.tsx`,
  géométrie Lucide standard) pleine/vide selon l'état, `hover:scale-[1.15]`
  + `active:scale-95`, et un "pop" rejoué à CHAQUE clic (`key={value}` sur
  l'icône, force un remontage qui rejoue `.animate-select-pop`) — jamais
  une icône statique. Valeur courante affichée à droite (`3/5`).
- **Curseur** (`RatingSlider.tsx`) — piste qui se remplit progressivement :
  un `<input type="range">` nu n'offre aucun moyen Tailwind générique de
  colorer uniquement la portion "remplie" (thumb/track sont des
  pseudo-éléments distincts par navigateur) — la portion remplie est donc
  un dégradé CSS calculé en `%` et posé en `style` inline
  (`.feedback-slider` dans `globals.css` ne fixe que l'apparence du
  thumb). Libellé qualitatif ("Peu"/"Moyennement"/"Tout à fait") et valeur
  numérique dans un badge circulaire au-dessus, jamais seulement le
  chiffre nu.
- **Choix multiples** (`ChoiceButtons.tsx`) — sélectionné = fond plein
  `bg-primary` + icône `circle-check` + ombre portée colorée, jamais une
  simple bordure fine ; nouveau contrôle testé sur ce point précis (une
  V1 utilisant `check-circle`, un tracé outline avec un chemin ouvert,
  rendait mal en `fill="currentColor"` — corrigé en `circle-check`, dont
  le cercle est un `<circle>` fermé, réellement adapté au remplissage).
- **Échelle 1-10** (`NumberScale.tsx`) — dégradé rouge → orange → vert
  (interpolation RVB sur les tokens sémantiques `danger`/`warning`/
  `success` déjà existants, jamais des couleurs hors charte) appliqué à la
  case SÉLECTIONNÉE uniquement : repère universel de type NPS, appliqué à
  ce seul contrôle — le reste de l'interface FeedbackApp garde
  exclusivement la palette bleue SIM Assurances.
- **Assistant "Conditions de travail"** (`Stepper`, `FeedbackForm.tsx`) —
  cercles numérotés avec 3 états visuellement distincts (à venir : fond
  neutre ; actif : fond primaire + halo `box-shadow` ; complété : fond
  primaire + icône `circle-check`), ligne de connexion qui se remplit
  (transition `width`, 500ms) plutôt qu'un simple changement de couleur
  instantané. Titre d'étape masqué sous `sm:` (place limitée en mobile),
  toujours visible en libellé texte au-dessus ("Étape X/4 — Titre").
- **Transitions onglet/étape** — fondu + léger glissement horizontal
  (`.animate-step-in`, `globals.css`), rejoué via `key={tab}`/`key={ctStep}`
  sur le conteneur de contenu (force un remontage à chaque changement) —
  jamais un changement de contenu instantané. Distinct de
  `.animate-fade-in-up` (glissement VERTICAL, pensé pour une apparition
  ponctuelle de carte) : un mouvement horizontal évoque ici une
  progression dans une séquence.
- **Confirmation de soumission** (`ConfirmationPanel`) — grand cercle vert
  qui s'anime en expansion douce (`.animate-confirm-ring`), jamais
  seulement le toast `useActionFeedback` (conservé en plus, pas en
  remplacement). Piège React évité : la bascule automatique de tab/reset
  après un délai (`setTimeout`) est déclenchée en dérivant l'état PENDANT
  le rendu (`if (state !== lastHandledState) { ...; setConfirmationTab(tab) }`
  — le pattern React officiel "adjusting state when a value changes"),
  jamais par un `setState` synchrone dans le corps d'un `useEffect` (le
  linter du projet le signale explicitement comme provoquant des rendus en
  cascade) — seul le `setTimeout` (asynchrone) à l'intérieur de l'effet
  appelle `setState`. Après une `COLLABORATION` réussie : réinitialise le
  formulaire et bascule vers l'onglet "Conditions de travail". Après une
  `CONDITIONS_TRAVAIL` réussie : réinitialise l'assistant (retour à
  l'étape 1) et appelle `router.refresh()` pour que le nouvel avis
  apparaisse immédiatement dans la liste publique en bas de la MÊME page
  — jamais un rechargement brut.
- **Liste publique** (`PublicFeedbackCard`) — vraies cartes (icône dans
  pastille `info`, barre d'accent verticale, `.card-shadow-hover`), plus
  une liste plate. État vide : `EmptyState` (composant partagé déjà
  existant, pastille + message), pas un texte gris isolé.

**Vérifications, parcours réel** :
- Parcours anonyme complet (requêtes réseau réelles, protocole Server
  Action) : soumission `COLLABORATION` → succès → soumission
  `CONDITIONS_TRAVAIL` → succès → le texte généré pour `CONDITIONS_TRAVAIL`
  apparaît sur `/feedback` en relecture, celui de `COLLABORATION` jamais.
- **Zéro cookie à chaque étape** revérifié : `GET /feedback` (anonyme),
  `GET /feedback/nouveau` (redirection), et les deux `POST /feedback`
  (soumissions) — aucun `Set-Cookie` dans les 4 cas.
- Un vrai `next build` passe intégralement (65 routes, `/feedback/nouveau`
  redevenu statique `○` puisque simple redirection).
- Aucune régression : `mes-retours` (compte destinataire réel) et
  `/feedback/admin` (compte avec `feedback.moderer`) fonctionnent toujours
  après le déplacement des fichiers et la fusion des pages ; le tableau de
  modération affiche toujours les deux `type`.
- Rendu mobile : vérifié par relecture de code (pas de capture d'écran
  disponible dans cet environnement) — grilles `grid-cols-1 sm:grid-cols-*`
  sur les cartes de réassurance/l'échelle 1-10/les onglets, titres d'étape
  masqués sous `sm:`, hero en `overflow-hidden` (le triangle de texture
  surdimensionné ne peut jamais provoquer de débordement horizontal).
  Aucune capture d'écran produite (outil non disponible dans cet
  environnement) — description précise fournie dans le résumé de la
  tâche pour validation par le maître de stage.

## Socle Portail — Authentification et permissions

### Contrat applicatif

`getSession()` / `hasPermission(session, "cle.permission")` /
`isAdmin(session)` / `getAccessibleModules(session)` — exportés par
`frontend/src/lib/auth.ts` (implémentation réelle dans
`backend/src/permissions.ts`, ré-exportée). **Toujours** vérifier les
permissions par ce contrat, jamais en dupliquant la logique, jamais en
appelant `auth()` directement ailleurs. Toute page/route/action protégée
revérifie la permission **dans son propre code**, jamais seulement via un
layout ou le masquage de l'UI.

- Provider Credentials uniquement, sessions JWT (pas d'adapter Prisma).
- Email de connexion : nettoyé (`trim()`) et recherché insensible à la
  casse (`mode: "insensitive"`) ; le mot de passe reste sensible à la
  casse.
- **« Se souvenir de moi »** — le cookie brut a toujours un plafond de 30
  jours (`session.maxAge`), seule limite qu'Auth.js v5 permet de fixer
  globalement. La durée réellement appliquée dépend d'un `exp` JWT
  personnalisé (`jwt.encode` custom lisant `token.rememberMe`) : 30 jours
  si coché, 1 jour sinon (décoché par défaut). `rememberMe` n'est jamais
  exposé côté `Session`, uniquement interne au JWT.
- **Déconnexion automatique après inactivité** — 60 minutes sans
  interaction physique réelle (`mousemove`/`mousedown`/`keydown`/`wheel`/
  `touchstart`/`scroll`, avec `event.isTrusted` revérifié), indépendant de
  l'âge de la session. Fonctionne même sur un onglet en arrière-plan
  (`setTimeout`, jamais `requestAnimationFrame`). Le rafraîchissement SSE
  ne compte jamais comme une activité.

### `estAdmin` — accès à la console `/admin`

`Role.estAdmin` (booléen) remplace toute comparaison sur `role.name`.
`isAdmin(session)` teste `session.estAdmin`, recalculé à chaque
`getSession()` depuis la base (jamais depuis le contenu du JWT — retirer
l'accès admin d'un rôle prend effet immédiatement).

- **Indépendant du système `RolePermission`** — un rôle `estAdmin: true`
  garde un accès total à `/admin` même sans aucune permission de module ;
  cocher `estAdmin` ne donne **aucune** permission métier `treso.*`/
  `pointage.*`. Le rôle « Admin » du seed n'a volontairement aucune
  `RolePermission` (accès module dérivé uniquement du bypass `estAdmin`
  dans `getAccessibleModules()`).
- **`estAdmin` est figé après la création d'un rôle** — réglable
  uniquement à la création (`creerRoleAction`), plus jamais modifiable
  ensuite. `toggleRoleEstAdminAction` existe encore dans le code mais
  refuse systématiquement toute exécution (et est de toute façon retirée
  du manifeste de build Next.js, injoignable en pratique). Ce durcissement
  remplace l'ancienne protection dynamique « dernier rôle admin » (comptage
  à chaque tentative de retrait), devenue sans objet.
- `backend/prisma/set-admin.ts` (relancé à chaque déploiement) rétablit
  systématiquement `estAdmin: true` sur le rôle nommé « Admin » s'il ne
  l'est plus — filet de sécurité pour toute base migrée depuis un état
  antérieur à `estAdmin`.
- **Anomalie connue, non résolue** : le rôle « Admin » porte aujourd'hui en
  base 23 `RolePermission` réelles (toutes les permissions `treso.*`/
  `pointage.*`), ce qui contredit l'invariant documenté ci-dessus. Origine
  identifiée (rafale de clics le 2026-09-10, probablement liée à un test
  manuel sur le Module Pointage RH) mais jamais corrigée ni actée comme
  choix définitif — à trancher : soit retirer ces permissions pour revenir
  à l'invariant, soit documenter explicitement que l'Admin les porte
  désormais par choix assumé.

### Délégation individuelle de permissions (`PermissionDelegation`)

Permet à un utilisateur cumulant des permissions `treso.*`/`pointage.*` (ex:
un rôle combiné « Finance/RH ») d'accorder à un compte **déjà existant** un
accès précis, sans jamais dépasser ce qu'il possède lui-même.

- Une ligne = une permission déléguée d'un `donneur` vers un
  `beneficiaire`, `estActive`/`revokedAt`/`revokedById` — révocation
  jamais une suppression ni une réécriture, un nouvel octroi crée toujours
  une nouvelle ligne.
- **Calcul dynamique, jamais figé** : à chaque `getSession()`, une
  délégation active n'est comptée que si le donneur possède **encore**
  cette permission via son rôle actuel et reste actif — sinon
  silencieusement neutralisée dans le calcul (la ligne reste `estActive:
  true` en base, sans être réécrite). Si le donneur retrouve la permission,
  le bénéficiaire la retrouve automatiquement.
- `getSession()` expose deux listes distinctes : **`permissions`**
  (effective : rôle + délégations actives valides — celle que
  `hasPermission()` consulte partout) et **`rolePermissions`** (brute,
  uniquement le rôle — seule base pour déléguer : **interdit toute
  chaîne de délégation en cascade**, un bénéficiaire ne peut jamais
  redéléguer ce qu'il n'a reçu que par délégation).
- **`accorderDelegationAction`** — plafonné strictement côté serveur : la
  permission doit appartenir à `tresorerie`/`pointage`, le donneur doit la
  posséder via `session.rolePermissions` (jamais via une délégation
  reçue), pas d'auto-délégation, bénéficiaire actif et déjà activé (mot de
  passe défini).
- **`Role.peutEtreBeneficiaireDelegation`** (booléen, librement modifiable
  à tout moment depuis `/admin/roles`, contrairement à `estAdmin`) —
  détermine qui peut être choisi comme bénéficiaire. Jamais déduit d'un nom
  de rôle en dur. **Deux cas explicites l'ont à `true` par défaut** (aucun
  autre) :
  - « Collaborateur » (seed + migration de rattrapage, cas d'origine).
  - **« Assistant Finance »** (Tâche "Séparation Responsable Finance /
    Assistant Finance", voir plus bas) — **exception délibérée dès la
    création du rôle**, pas un oubli : un Responsable Finance doit pouvoir
    déléguer au cas par cas à son Assistant l'une des trois actions qu'il
    ne possède pas par défaut (alimentation de caisse, correction du solde
    d'ouverture, dépense directe), sans lui donner l'accès de façon
    permanente via son rôle.
- `revoquerDelegationAction` : le donneur d'origine, **ou** un Admin
  (`/admin/delegations`, vue de toutes les délégations tous donneurs
  confondus).
- Un compte ayant accordé ou reçu au moins une délégation (active ou
  révoquée) ne peut plus être supprimé définitivement (voir plus bas),
  seulement désactivé.

### Restreindre "Déléguer des accès" au Responsable Finance

Accès à `/delegations` resserré : jusqu'ici accessible à quiconque
possédait au moins une permission `treso.*` OU `pointage.*` via son propre
rôle — trop large, ouvrait la page à RH (permissions Pointage RH) et à
n'importe quel profil Trésorerie (Assistant Finance, DG). Réservé
désormais au Responsable Finance UNIQUEMENT.

**Garde retenue : `treso.valider_demande` ET PAS
`treso.approuver_validation_complete`** (sur `session.rolePermissions`,
jamais `session.permissions`, inchangé) — **`treso.valider_demande` seule
ne suffit PAS** : le rôle DG la possède aussi (il valide/rejette les
demandes au même titre que Finance, voir "Module Trésorerie — validation").
Une restriction littérale sur cette seule permission aurait donc laissé le
DG accéder à la page, contredisant l'exigence explicite de l'exclure.
**Conflit de spécification signalé et tranché avec l'utilisateur** (pas
une décision prise seule) : la seconde condition (absence de
`treso.approuver_validation_complete`, le marqueur du DG, jamais transmis
à Finance dans le seed) exclut spécifiquement ce rôle sans jamais comparer
de nom de rôle en dur — même principe que `estAdmin`/
`peutEtreBeneficiaireDelegation`. Alternative écartée : utiliser
`treso.cloturer_demande` seule (qui identifie déjà exclusivement Finance
aujourd'hui) — non retenue pour rester au plus près de la permission
explicitement nommée dans la demande.

Trois points de garde mis à jour avec exactement la même condition,
jamais dupliquée sous une forme divergente :
- `delegations/page.tsx` — redirection si non éligible.
- `accorderDelegationAction` (`delegations/actions.ts`) — revérifiée en
  tout début de fonction, avant `verifierEligibiliteDonneur` ; jamais
  seulement le masquage de page/formulaire.
- `(dashboard)/layout.tsx` — `canDelegerAcces` (nav), qui pilotait déjà
  `DELEGATIONS_ITEM` dans `Sidebar.tsx` : aucune modification nécessaire
  côté `nav.ts`/`Sidebar.tsx` eux-mêmes, seul le booléen d'entrée était
  trop large.
- `revoquerDelegationAction` **volontairement PAS restreinte** : un
  donneur (même RH) garde la capacité de révoquer une délégation qu'il a
  lui-même déjà accordée par le passé (ou un Admin, comme avant) — jamais
  bloqué par ce resserrement, qui ne porte que sur l'OCTROI de nouvelles
  délégations.

**Délégations RH existantes vérifiées, aucune orpheline** : requête
directe sur les 13 `PermissionDelegation` de la base de dev partagée (5
actives, 8 révoquées) — **toutes accordées par un donneur possédant déjà
`treso.valider_demande` sans `treso.approuver_validation_complete`**
(en pratique, toutes par le compte de test "Finance"), aucune par un
compte RH. Rien à traiter dans cette base ; si une délégation RH existait,
elle resterait active en base (jamais supprimée par ce changement, qui ne
touche que l'accès à la PAGE/l'action d'octroi) mais devenue non-gérable
(non-révocable) par son donneur RH lui-même — seul un Admin pourrait
encore la révoquer via `/admin/delegations`. **À surveiller sur une base
avec un historique différent.**

**Vérifications, parcours réel + rejeux réseau (comptes de test)** :
- Finance (Responsable) : `GET /delegations` → 200, formulaire complet
  visible, lien "Déléguer des accès" présent dans la sidebar.
- Assistant Finance, DG, RH, Collaborateur : `GET /delegations` → 307
  vers `/?error=acces_refuse_delegations`, lien absent de la sidebar pour
  les quatre (confirmé par recherche de `href="/delegations"` dans le
  HTML rendu — 0 occurrence).
- Rejeu réseau direct de `accorderDelegationAction` (arguments arbitraires,
  le contrôle de permission précède toute lecture DB) : refusé
  (`"Action non autorisée."`) pour Assistant Finance/DG/RH/Collaborateur ;
  passe la garde pour Finance (échoue ensuite normalement sur
  "Fonctionnalité introuvable" faute d'un `permissionId` réel — preuve
  que seule la NOUVELLE restriction, pas une régression, a été testée).

### Suppression définitive d'un compte utilisateur

`supprimerUtilisateurAction(userId)` (`admin/users`) — possible **si et
seulement si** le compte n'a jamais servi à rien : 18 relations vérifiées
(créateur/bénéficiaire/approbateur de demande, auteur de règlement,
déclarant/receptionnaire de retour, auteur d'entrée d'historique,
utilisateur du journal de caisse, employé/auteur de pointage/correction/
absence, destinataire de notification, plage d'absence autorisée, donneur
ou bénéficiaire de délégation, **auteur d'un motif Finance sur dépense non
justifiée** — voir "Motif Finance sur dépense non justifiée"). Si au moins
une relation existe : refus
avec message précis listant chaque catégorie non nulle, invitant à
désactiver plutôt. Sinon : suppression réelle + `HistoriqueEntry`.
Toujours refusée pour l'auto-suppression et pour le **dernier compte dont
le rôle a `estAdmin: true`** (comptage des autres comptes admin restants).
Confirmation à deux temps côté UI, la vraie autorité restant toujours
côté serveur.

### Gestion sécurisée des Catégories/Objets

- CRUD complet (création, activation/désactivation, budget alloué)
  toujours réservé à `isAdmin()` sur `/admin/categories`.
- **`treso.gerer_categories`** (Finance dans le seed) ouvre en plus
  `/treso/finance/categories` — réutilise les mêmes composants que
  `/admin/categories`, mais limité à **créer** et **supprimer**
  (Activer/Désactiver et Budget alloué restent Admin-only, gardés comme
  leviers de configuration globale distincts).
- **Suppression définitive** (`supprimerCategorieAction`/
  `supprimerObjetAction`, n'existait pour personne avant, y compris
  l'Admin) : bloquée si au moins un Objet rattaché, au moins une Demande
  référençant directement la Catégorie/l'Objet, ou (pour une Catégorie) si
  `budgetAlloue` n'est pas `null`. Message de refus précis, invitant à
  désactiver plutôt.

### Invitation par lien

Deuxième méthode de création de compte (en plus de la création manuelle
avec mot de passe immédiat) : l'Admin renseigne nom/email/rôle, génère un
lien (`/invitation/{token}`, jeton aléatoire 256 bits, expire à J+7), et le
transmet lui-même — **aucun envoi d'email automatique n'existe dans le
projet**. `User.passwordHash` est nullable ; un compte « en attente »
(`isActive: false`, pas de mot de passe) ne peut pas se connecter tant que
la personne n'a pas finalisé son mot de passe via ce lien. Régénération de
lien possible pour un compte encore en attente.

### Service d'un utilisateur (`/admin/users`)

Chaque compte porte un `Service` optionnel (`User.serviceId`, nullable —
géré via `/admin/services`, ajouté par Thierry). Deux points d'écriture :

- **À la création** (`createUserAction`, `creerInvitationAction`) —
  **bug corrigé** : `createUserAction` omettait `serviceId` de l'objet
  passé à `safeParse()` (le schéma le déclarait, le `prisma.user.create`
  le référençait, mais `parsed.data.serviceId` valait toujours `undefined`
  faute d'être dans l'objet validé) — un service choisi dans le formulaire
  de création manuelle n'était donc **jamais** appliqué, quel que soit le
  choix de l'Admin. `creerInvitationAction`, elle, l'incluait déjà
  correctement. Corrigé en ajoutant `serviceId: formData.get("serviceId")`
  à l'objet de `createUserAction`.
- **Après création** (`updateUserServiceAction`, select inline dans le
  tableau des comptes, `UserServiceSelect.tsx`) — **bug signalé, non
  reproduit malgré un diagnostic approfondi** (dev et build de production
  standalone réel, vue bureau et carte mobile, changement isolé et
  rafales, navigation dure et douce, rechargement complet, et une
  simulation délibérée de course avec une mutation concurrente générant
  du bruit SSE ambiant) : dans chaque tentative, l'écriture en base
  réussissait et l'UI reflétait correctement la nouvelle valeur, y
  compris après rechargement complet. Cause exacte non confirmée
  empiriquement. **Durcissement appliqué par relecture de code** :
  `UserServiceSelect` resynchronisait sa sélection locale depuis
  `currentServiceId` via un `useEffect` à CHAQUE rendu du tableau — y
  compris ceux déclenchés par le SSE global `publishDataChanged()`
  (diffusé à TOUT changement, n'importe où dans l'app, jamais scopé à la
  ligne modifiée, voir "Rafraîchissement en temps réel"). Si une réponse
  réseau retardée d'un tel rafraîchissement sans rapport reflétait un état
  antérieur à l'écriture en cours sur cette ligne précise (course
  plausible sous activité concurrente réelle, seulement en production
  avec plusieurs utilisateurs simultanés — jamais reconstituée en local),
  la sélection revenait visuellement en arrière bien que l'écriture ait
  réussi. Retiré : `UserServiceSelect` s'initialise désormais UNE SEULE
  fois depuis `currentServiceId` (`useState`, jamais resynchronisé), même
  principe que `UserRoleSelect.tsx` (non affecté par ce bug) — la seule
  correction de valeur reste désormais le rollback explicite en cas
  d'échec réel de l'action, jamais un effet de bord d'un rafraîchissement
  global sans rapport. **À confirmer si le bug réapparaît malgré ce
  changement** : signe qu'une autre cause reste à trouver.

### Console admin (`/admin`)

Routes : `/admin/users` (créer manuellement ou par invitation, activer/
désactiver, changer le rôle, supprimer si jamais utilisé), `/admin/roles`
(matrice de permissions par module, créer un rôle avec `estAdmin`/
`peutEtreBeneficiaireDelegation` réglés à la création), `/admin/modules`
(activer/désactiver un module), `/admin/categories` (Catégories/Objets),
`/admin/delegations` (toutes les délégations). Chaque case à cocher
applique la mutation immédiatement (pas de bouton « Enregistrer » global).
Toute mutation est historisée dans `HistoriqueEntry`.

`DataTable` étant un Client Component, ses `columns` (avec leurs fonctions
`accessor`/`render`) ne peuvent jamais être construites dans une page
Server Component puis passées en props — toujours un petit wrapper Client
Component qui reçoit les données et construit lui-même les colonnes.

## Rafraîchissement en temps réel (SSE)

Le portail ne fait plus de polling : `src/lib/eventBus.ts` (singleton en
mémoire du process, `node:events`, conservé sur `globalThis` en dev pour
survivre au hot-reload) expose `publishDataChanged()`/
`subscribeDataChanged()`. `GET /api/events` (Route Handler SSE, sessions
authentifiées uniquement) diffuse un évènement `"data-changed"` ; `Topbar`
ouvre un `EventSource` au montage de l'AppShell et appelle
`router.refresh()` à chaque réception — **entièrement invisible** (aucun
bouton, aucun indicateur). Chaque Server Action qui modifie une donnée
affichée appelle `publishDataChanged()` en plus de ses `revalidatePath`.

**Limite connue** : le bus est en mémoire d'un seul process — ne
fonctionne qu'avec une seule instance de serveur (le déploiement actuel).
Un scaling horizontal futur nécessiterait un bus partagé (Redis pub/sub).

Protection anti-perte de saisie : un évènement reçu pendant qu'un champ
(`INPUT`/`TEXTAREA`/`SELECT`) a le focus est différé et appliqué au
`focusout`, jamais perdu ni appliqué en plein milieu d'une saisie.

## Design system — état actuel (post-rehaussement visuel)

En plus de la palette/typographie/composants de base (voir plus haut) :

- **Typographie** : tout montant financier qui EST l'information (pas une
  donnée annexe) reçoit `font-black`/`font-bold` + `tabular-nums` + une
  taille nettement supérieure à son libellé. Les libellés de `StatCard`
  restent en casse normale (jamais tout-majuscules, un des « tells »
  génériques à éviter).
- **Icônes de `StatCard`** : toutes en `bg-primary` (bleu SIM Assurances
  uniforme), quelle que soit la carte — seuls le filet de tête (3px) et le
  halo hover/focus varient encore selon `tone`/`toneSiActif` (signal
  d'urgence : une carte « à traiter » avec un compteur > 0 s'allume dans sa
  teinte, à 0 elle repasse en neutre).
- **Toasts sonner** : succès en bleu SIM Assurances (`primary-bg`/
  `primary`), pas vert — erreur/info/warning inchangés.
- **`--color-app-bg` = `#ffffff`** (fond blanc uniforme sur toute
  l'application, plus de gris-bleu pâle). `Card`/`StatCard` se détachent
  via `shadow-elevated` (ombre teintée bleu primaire) ; `DataTable` et les
  panneaux HTML bruts du reporting en ont été dotés pour la même raison.
- **Logo** : assets vectoriels (`public/logo-sim-blanc.svg`,
  `logo-sim-couleur.svg`), plus de bitmap WebP. Icône seule (triangle)
  factorisée dans `src/components/ui/brandIcon.ts`, réutilisée par la
  sidebar réduite, le favicon programmatique (`src/app/icon.tsx`/
  `apple-icon.tsx`) et `BrandBackdrop`.
- **`BrandBackdrop`** (filigrane pâle du pictogramme + fine bordure bleue,
  registre « papier à en-tête ») appliqué à **toute l'application**
  (`fixed`, `z-0` explicite sur le conteneur racine de l'AppShell —
  nécessaire, un `-z-10` sans stacking context propre le rend invisible),
  pas seulement `/login` : opacité 0.05 dans l'AppShell (contre 0.09 sur
  `/login`), positionné en coin bas-droit (`corner-br`) pour ne jamais
  interférer avec la Sidebar/Topbar.
- **`DataTable` responsive** : en dessous de `md`, bascule automatiquement
  en liste de cartes empilées (première colonne = titre, colonne
  « Actions » détachée en pied de carte) — les tableaux HTML bruts du
  reporting (grille dense, ligne de total) restent volontairement en mode
  tableau avec indice de défilement horizontal.

### Refonte visuelle des écrans d'authentification (connexion, mot de passe oublié, réinitialisation)

Changement **purement visuel** — aucune Server Action, validation,
redirection ni message d'erreur/succès n'a été modifié. Les 3 écrans
(`/login`, `/forgot-password`, `/reset-password/[token]`) sont passés d'une
carte unique (bandeau bleu + logo blanc en tête) à une carte scindée en
deux, à l'identique dans l'esprit d'une maquette de référence fournie
(panneau blanc formulaire + panneau illustré en dégradé de marque), avec
l'identité réelle SIM Assurances. **Le 4ᵉ écran du même groupe de routes,
`/invitation/[token]`, est volontairement resté sur son ancien habillage**
(hors périmètre de la tâche) — voir plus bas pourquoi ceci exclut
délibérément un vrai `(auth)/layout.tsx`.

**Aucun écran d'inscription** : le projet n'a jamais eu de flux "Sign Up"
(comptes créés uniquement par l'Admin, voir "Invitation par lien") —
confirmé qu'aucune des 3 pages ni le nouveau composant partagé n'y fait
la moindre allusion, vérifié par recherche de texte sur les pages rendues.

- **`src/app/(auth)/AuthShell.tsx`** (nouveau, Server Component) — coquille
  visuelle partagée par les 3 pages, importée explicitement par chacune
  (JAMAIS un `(auth)/layout.tsx`, qui aurait involontairement restylé
  `/invitation/[token]` au passage — ce 4ᵉ écran du même groupe de routes
  n'était pas dans le périmètre de la tâche). Structure : `grid
  sm:grid-cols-5`, panneau gauche blanc `sm:col-span-3` (logo couleur
  `logo-sim-couleur.svg` + `children`, le contenu propre à chaque page) et
  panneau droit `sm:col-span-2` (~40%) `hidden sm:flex` — **masqué
  entièrement sur mobile** (jamais réduit à un bandeau, la maquette de
  référence proposait les deux options ; masquer entièrement est plus
  simple et le formulaire reste pleinement lisible seul). Un
  `<BrandBackdrop>` supplémentaire, discret (`opacity-[0.05]`), habille le
  fond de page derrière la carte.
- **Panneau droit** : `.brand-gradient-bg` (classe déjà existante,
  réutilisée telle quelle — jamais un second dégradé défini) + un
  `<BrandBackdrop>` en filigrane **clair** (voir prop `watermarkColorClassName`
  ci-dessous), `watermarkPosition="corner-br"`, `showBottomAccent={false}`
  (le filet dégradé du bas n'a plus de sens sur un fond déjà bleu) + un
  texte d'accroche fixe ("Bienvenue sur le portail SIM Assurances") et une
  sous-phrase (`tagline`, prop de `AuthShell`) courte, adaptée par écran
  (contexte trésorerie pour la connexion, confidentialité pour la demande
  de réinitialisation, sécurité du compte pour le nouveau mot de passe).
- **`BrandBackdrop.tsx` étendu** — nouvelle prop optionnelle
  `watermarkColorClassName` (défaut `"text-muted-foreground"`, comportement
  **strictement inchangé** partout où elle n'est pas passée : `/invitation`,
  l'AppShell, et l'usage par défaut sur le fond de page des 3 écrans
  restylés eux-mêmes). Seul le panneau droit (fond bleu) la passe à
  `"text-white"` — le filigrane gris pensé pour un fond clair aurait été
  quasi invisible sur un fond déjà bleu.
- **Logo** : les 3 écrans affichent désormais `logo-sim-couleur.svg` (le
  vrai logotype couleur) sur le panneau blanc, en remplacement du bandeau
  bleu + `logo-sim-blanc.svg` (blanc) de l'ancien habillage — conforme à la
  consigne explicite "le vrai logotype couleur, pas une version custom".
  `logo-sim-blanc.svg` reste utilisé ailleurs dans le portail (en-tête du
  Socle Portail, sur fond bleu) — aucun changement à cet usage.
- **Composants de formulaire réutilisés tels quels** — `Input`/`Button`
  (design system existant), aucun nouveau composant de champ créé ; seule
  la mise en page environnante (carte, logo, panneau illustré) a changé.
  Le contenu de chaque page (`page.tsx`) — titres, bannières d'erreur/
  succès, champs, `LoginSubmitButton`/`ForgotPasswordForm`/
  `ResetPasswordForm` — a été déplacé tel quel à l'intérieur de
  `<AuthShell>`, jamais réécrit : `login/actions.ts`
  (n'existe pas, la Server Action `authenticate` reste inline dans
  `page.tsx`), `forgot-password/actions.ts`, `reset-password/[token]/actions.ts`,
  `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`, `LoginSubmitButton.tsx`
  n'ont subi AUCUNE modification.
- **Bordure de page bleue épaisse retirée** (`border-[3px] border-primary`
  de l'ancien conteneur plein écran) — remplacée par l'élévation de la
  carte elle-même (`shadow-elevated-lg`, déjà existante) sur un fond de
  page blanc/neutre : plus proche de la maquette de référence (fond clair,
  carte qui se détache par l'ombre plutôt que par un cadre), le panneau
  droit en dégradé bleu portant désormais l'essentiel de l'identité de
  couleur de l'écran.

**Vérifications, parcours réel (Playwright headless, comptes de test réels,
installé temporairement `--no-save` puis désinstallé après usage — même
convention que les vérifications précédentes de ce projet)** :
- Connexion avec identifiants invalides → bannière d'erreur affichée,
  bien intégrée visuellement dans le panneau gauche (capture d'écran
  vérifiée) ; connexion avec identifiants valides → redirection réelle
  hors de `/login` (vers `/`), confirmée par l'URL finale.
- Parcours complet mot de passe oublié → réinitialisation : demande
  envoyée (mode simulation, aucun SMTP configuré dans `.env`, comportement
  inchangé) → jeton retrouvé directement en base (équivalent du lien reçu
  par email en production) → `/reset-password/[token]` accepte un nouveau
  mot de passe conforme à la politique de complexité déjà existante
  (inchangée) → redirection vers `/login?reset=success` avec bannière de
  succès → connexion réussie avec le nouveau mot de passe. Compte de test
  ensuite restauré à son mot de passe d'origine (écriture directe du hash
  bcrypt, la politique de complexité du formulaire de réinitialisation
  étant plus stricte que l'ancien mot de passe de test en clair — sans
  rapport avec cette tâche, un début de constat déjà présent avant elle).
- **Mobile (390px)** : panneau illustré confirmé absent du DOM visible
  (`.brand-gradient-bg` non visible), largeur du document égale à la
  largeur du viewport sur les 2 écrans testés (aucun scroll horizontal),
  formulaire pleinement lisible.
- **Aucune occurrence** de "sign up"/"s'inscrire"/"inscription"/"créer un
  compte" sur les pages rendues (recherche de texte exhaustive).
- `tsc --noEmit`, `eslint` et un vrai `next build` (65 routes) passent
  sans erreur.

### Animation d'entrée de l'écran de connexion

Suite directe de la tâche ci-dessus, réservée à `/login` UNIQUEMENT (jamais
`forgot-password`/`reset-password`, hors périmètre, rendu strictement
inchangé pour ces deux écrans) — inspirée d'une maquette de référence
("QRApp", une autre application SIM Assurances, modèle d'interaction
uniquement, aucun contenu copié). Seuls `AuthShell.tsx` et `login/page.tsx`
touchés ; aucune Server Action, validation ou logique métier modifiée.

**Comportement** : au chargement, le panneau bleu de marque occupe toute
la largeur de l'écran (logo blanc, accroche, bouton "Se connecter"
centrés) ; au clic (ou activation clavier), il se rétracte sur la GAUCHE
(~57%) pendant que le formulaire de connexion glisse depuis la droite
(~43%) — un MIROIR délibéré du placement form-gauche/bleu-droite des 2
autres écrans, imposé par le sens de la maquette de référence, spécifique
à `/login`.

**`AuthShell.tsx` reçoit deux nouvelles props** :
- `animatedIntro` (défaut `false`) — seul `/login` la passe à `true`.
  Quand `false`, la branche de rendu est **strictement identique** à
  l'implémentation d'avant cette tâche (copié-collé intact) : zéro
  régression possible sur `forgot-password`/`reset-password`.
- `skipIntro` (défaut `false`) — calculé par `login/page.tsx` à partir de
  ses propres `searchParams` (`Boolean(error || activated || reset)`).
  Nécessaire car `revealed` (l'état React qui pilote l'animation) doit
  **rester stable pendant toute interaction normale du formulaire**
  (échec de connexion, déconnexion pour inactivité, compte activé, mot de
  passe réinitialisé — tous ces cas rechargent `/login` avec un paramètre
  d'URL déjà présent après le `redirect()` du Server Action) : `revealed`
  démarre directement à `true` dans ces cas, jamais de rejeu de
  l'animation. Un simple F5 sur `/login` **sans paramètre**, lui, repart
  bien de l'état plein écran (comportement explicitement demandé) —
  `skipIntro` ne s'applique que si l'URL porte déjà la preuve d'une
  interaction précédente.

**Architecture "grille fixe + calque de recouvrement"** — PAS une grille
dont les colonnes changeraient de largeur (`0%` → `43%`), premier essai
tenté puis abandonné : faire passer la largeur RÉELLE de la colonne
formulaire à `0%` (même avec `min-w-0`) force son contenu à se reformater
sur une largeur quasi nulle, ce qui gonflait sa hauteur naturelle et
provoquait exactement le saut de mise en page à éviter (mesuré en
pratique : 638px avant clic contre 444px après, sur le même écran).
Solution retenue :
- La grille RÉELLE (`sm:grid-cols-[57%_43%]`) ne change **jamais** de
  proportions — sa hauteur est donc constante dès le premier rendu, sans
  deviner de valeur `min-h-[...]` arbitraire.
- Un calque `absolute` (le "panneau bleu" perçu par l'utilisateur) couvre
  toute la carte (`w-full`) au chargement, se rétracte à `sm:w-[57%]` au
  clic (`inset-y-0` fige sa hauteur sur celle, déjà stable, de la carte —
  son propre contenu ne peut donc jamais influencer la hauteur de qui que
  ce soit).
- **Piège trouvé et corrigé en cours de route** : une fois rétracté à
  `57%`, ce calque coïncide EXACTEMENT avec la colonne bleue réelle en
  dessous — un premier essai ne faisait fondre que le CONTENU du calque
  (son titre/accroche/bouton), jamais le calque lui-même, dont le fond
  opaque (`brand-gradient-bg`) continuait donc à recouvrir la colonne
  réelle POUR TOUJOURS derrière lui (constaté en pratique : panneau bleu
  resté vide, sans titre ni accroche, après un clic ou un rechargement
  avec `?error=1`). Corrigé en faisant aussi disparaître le calque
  lui-même en opacité, mais SEULEMENT sur les 200 dernières ms des 500ms
  de rétrécissement (`transition-[width_500ms_ease-out,opacity_200ms_ease-out_300ms]`,
  syntaxe de transition arbitraire Tailwind à propriétés multiples) —
  jamais en même temps que le rétrécissement (un fondu concurrent aurait
  rendu le calque semi-transparent PENDANT qu'il recouvre encore la zone
  du formulaire en train d'apparaître) : le délai est choisi pour que la
  colonne bleue réelle en dessous ait déjà fini d'apparaître (son propre
  fondu se termine à 450ms) avant que le calque ne s'efface à son tour à
  500ms — aucune discontinuité visible, le texte semble simplement
  apparaître une fois le calque retiré.
- `border`/`shadow-elevated-lg` restent volontairement présents dans les
  deux états (jamais togglés) : `box-shadow: none`/`border-width: 0` ne
  s'animent pas proprement vers une vraie valeur (saut instantané, même
  limitation CSS que `height: auto`) — les garder actifs en permanence les
  rend simplement invisibles quand la carte touche les bords du viewport
  (état plein écran), puis ils "apparaissent" naturellement dès qu'elle
  s'en détache en rétrécissant.

**Accessibilité clavier — piège trouvé et corrigé** : le point d'entrée
est un vrai `<button>` (focusable/activable au clavier nativement, jamais
un `<div onClick>`). Un premier test clavier réel a révélé un bug distinct :
même recouverts par le calque opaque, les champs de LA COLONNE FORMULAIRE
RÉELLE (email, mot de passe, case à cocher, lien, bouton — tous
techniquement "visibles" au sens CSS, seulement peints par-dessus) restent
dans l'ordre de tabulation naturel du navigateur — un utilisateur clavier
tombait donc d'abord sur ces champs invisibles avant d'atteindre le bouton
"Se connecter", et valider Entrée sur un champ email cargo vide
déclenchait la bulle de validation HTML5 native du navigateur SANS AUCUN
CHAMP VISIBLE À L'ÉCRAN. Corrigé avec l'attribut natif `inert` (React 19) :
- La colonne formulaire réelle reçoit `inert={isDesktop && !revealed}` —
  `isDesktop` détecté côté client via `matchMedia("(min-width: 640px)")`
  (défaut `false`, sûr pour le rendu serveur/l'hydratation) : sur mobile,
  où `revealed` ne peut de toute façon jamais être activé par un clic
  (calque et bouton masqués, voir plus bas), ce formulaire doit rester
  TOUJOURS pleinement interactif — sans cette garde `isDesktop`, un
  `inert` inconditionnel aurait rendu le formulaire mobile durablement
  inutilisable.
- Le calque plein écran reçoit `inert={revealed}` (sans besoin de la même
  garde `isDesktop` : sur mobile il est déjà `hidden`, donc déjà hors
  d'atteinte). `inert` retire à la fois la focusabilité ET l'exposition
  aux technologies d'assistance en une seule fois — le `tabIndex={-1}`/
  `aria-hidden` posés séparément dans un premier essai sont devenus
  redondants et ont été retirés.

**Mobile — solution retenue et justification** : le panneau bleu (calque
ET colonne réelle) reste `hidden sm:flex` en permanence, exactement comme
le panneau illustré des 2 autres écrans — **jamais d'interstitiel plein
écran sur mobile**, le formulaire est immédiatement visible dès le
chargement. Justification : l'animation est une transformation
essentiellement HORIZONTALE (un panneau qui se rétracte latéralement pour
en révéler un autre) — sur un écran portrait déjà trop étroit pour afficher
les deux panneaux côte à côte (décision déjà prise et vérifiée dans la
tâche précédente), rejouer cette même mécanique n'aurait guère de sens
et ajouterait une étape de friction pure (un écran d'accueil à écarter)
pour un utilisateur mobile venu se connecter rapidement — la cohérence
avec le comportement mobile déjà établi et vérifié des 2 autres écrans
(jamais remis en cause) l'emporte sur une fidélité littérale à la maquette
desktop.

**Vérifications, parcours réel (Playwright headless, comptes de test
réels, installé temporairement `--no-save` puis désinstallé après usage)** :
- Chargement initial : panneau bleu plein écran (1440px de large, pleine
  largeur du viewport), logo, titre et accroche lisibles, bouton "Se
  connecter" visible et centré.
- Clic sur le bouton → transition déclenchée → carte recentrée (896px,
  `max-w-4xl`), panneau bleu à gauche (~57%) AVEC son titre/accroche
  visibles, formulaire à droite (~43%) pleinement fonctionnel — **écart de
  hauteur entre les deux états mesuré à 0px** (bounding box identique
  avant/après, confirmant l'absence de saut de mise en page).
- Connexion avec identifiants invalides (formulaire déjà révélé) →
  bannière d'erreur affichée, **formulaire toujours révélé, aucun
  réaffichage du panneau plein écran ni du bouton** (pas de
  re-déclenchement de l'animation) ; connexion avec identifiants valides →
  redirection réelle vers `/`.
- **F5 sur une session fraîche, sans paramètre d'URL** → reste bien à
  l'état plein écran (bouton "Se connecter" toujours visible) — pas de
  mémorisation d'état intempestive.
- **Activation clavier** : `Tab` atteint directement le bouton "Se
  connecter" en 1 seul saut (confirmé APRÈS le correctif `inert` —
  atteignait à tort des champs invisibles du formulaire recouvert avant
  correction), `Entrée` déclenche la révélation exactement comme un clic,
  sans bulle de validation HTML5 parasite.
- **Mobile (390px)** : formulaire directement visible dès le chargement,
  bouton "Se connecter" du panneau bleu absent (`isVisible: false`),
  largeur du document égale à celle du viewport (aucun scroll horizontal).
- `forgot-password` rechargé et confirmé visuellement identique à avant
  cette tâche (carte scindée statique, jamais de panneau plein écran).
- Aucune erreur JavaScript capturée dans la console sur l'ensemble du
  parcours.
- `tsc --noEmit`, `eslint` et un vrai `next build` (65 routes) passent
  sans erreur.

### Nouvelle disposition de l'état "formulaire révélé" + filigrane plus marqué

Suite directe de la tâche ci-dessus, toujours limitée à `AuthShell.tsx`
(branche `animatedIntro`) et purement visuelle — aucune Server Action, ni
validation, ni comportement touché. Remplace le split "panneau bleu ~57% /
formulaire ~43%" par une disposition à calques : **le fond bleu de marque
occupe TOUJOURS toute la page, sans jamais rétrécir**, et le formulaire de
connexion apparaît comme une **carte blanche flottante, centrée**,
par-dessus ce fond permanent.

**Filigrane plus marqué, scopé au hero de connexion uniquement** —
`BrandBackdrop.tsx` n'a **pas été modifié** : son prop déjà existant
`watermarkOpacityClassName` suffisait très exactement à ce que la tâche
suggérait ("passe par une prop dédiée plutôt que de changer le composant
globalement"). Seule la VALEUR passée depuis l'unique appel du fond bleu
de `/login` change, de `opacity-[0.16]` à `opacity-[0.32]` — le double.
Tous les autres usages du composant restent strictement à leur valeur
d'origine : `0.05`/`0.09` (fond de page clair, `/login` et les 2 autres
écrans), `0.16` (panneau bleu de `/forgot-password`/`/reset-password`,
INCHANGÉ — la tâche vise explicitement "le hero de connexion", pas les 2
autres écrans), `0.035`/`0.05` (AppShell, sur fond clair). Le hero
FeedbackApp et les cartes "Vos accès" du dashboard n'utilisent de toute
façon pas ce composant (filigrane construit à la main à partir de
`brandIcon.ts` directement dans ces fichiers) — aucun risque de les
affecter par ricochet. Contraste vérifié par capture d'écran réelle : le
triangle est désormais un vrai élément graphique visible du fond, tout en
laissant le titre/l'accroche/le logo blanc parfaitement lisibles par-dessus
(le filigrane reste cantonné au coin bas-droit, `watermarkPosition="corner-br"`,
inchangé, jamais superposé directement au bloc de texte central).

**Architecture — 3 calques `absolute inset-0` empilés dans un conteneur à
taille fixe**, remplace l'ancienne "grille fixe (57%/43%) + calque de
recouvrement à largeur variable" (dont l'historique — deux pièges
rencontrés et corrigés, saut de hauteur puis panneau resté vide — reste
documenté ci-dessus pour mémoire, mais ce mécanisme n'existe plus) :
1. **Fond bleu** (`brand-gradient-bg` + `BrandBackdrop`) — toujours
   `inset-0`, ne change JAMAIS de taille ni de position, masqué sur mobile
   (`hidden sm:block`, le fond y reste blanc comme avant cette tâche).
2. **Accueil** (logo blanc, titre, accroche, bouton "Se connecter") —
   centré sur tout l'écran, s'efface en fondu (`opacity`, 200ms) une fois
   révélé, `inert` pour ne jamais rester un arrêt de tabulation fantôme.
3. **Carte** (logo couleur + `children`, le formulaire) — centrée par un
   calque englobant qui la place au milieu de l'écran, apparaît en fondu +
   très léger agrandissement (`opacity-0 scale-95` → `opacity-100
   scale-100`, 300ms, `delay-150`) une fois révélée.

Le conteneur externe garde une taille **fixe** (`min-h-full flex-1`,
hauteur du viewport) en toute circonstance — les 3 calques sont tous
`absolute inset-0` et ne contribuent donc JAMAIS à cette taille : la carte
peut apparaître/disparaître sans le moindre effet sur la mise en page
environnante. Cette architecture est structurellement IMMUNISÉE contre le
type de saut de hauteur déjà rencontré sur l'ancienne disposition (rien ne
redimensionne plus jamais un élément en fonction de son contenu) — vérifié
en pratique par mesure directe de la bounding box du fond bleu avant/après
révélation : **écart de largeur et de hauteur mesuré à 0px dans les deux
cas**, et hauteur totale de page strictement identique (900px, la hauteur
du viewport de test) avant et après.

**Logo/accroche du hero : disparaissent en fondu, ne se repositionnent PAS
en haut de l'écran** — choix retenu parmi les deux options proposées par
la tâche, justifié : un simple fondu croisé (calque 2 s'efface, calque 3
apparaît, tous deux déjà centrés au même endroit) est robuste et ne
dépend d'aucun calcul de position lié à la taille du contenu ou du
viewport, contrairement à un repositionnement du logo vers le haut de
l'écran (qui aurait exigé de faire correspondre deux tailles/positions
différentes du même élément sans jamais chevaucher la carte pendant la
transition, une complexité et un risque de régression jugés disproportionnés
pour un gain visuel marginal). Conséquence assumée : une fois la carte
affichée, l'arrière-plan bleu est entièrement épuré (juste le filigrane),
sans titre ni accroche résiduelle — cohérent avec "la carte flotte SUR le
fond bleu" demandé, et visuellement plus propre qu'un texte qui se
déplacerait.

**Comportement gardé strictement inchangé** (vérifié explicitement,
aucune régression) : `revealed`/`skipIntro`/`isDesktop` (mêmes noms, même
logique, aucune de ces trois pièces d'état n'a changé) ; `inert` sur la
carte tant que non révélée sur desktop uniquement (même garde
`isDesktop && !revealed`, même raison — un utilisateur clavier ne doit
jamais tomber sur des champs cachés) ; aucun re-déclenchement de
l'animation après une soumission de formulaire (toujours piloté par
`skipIntro`, calculé de façon identique dans `login/page.tsx` — ce fichier
n'a d'ailleurs pas eu besoin d'être modifié pour cette tâche, ses props
passées à `AuthShell` restent les mêmes) ; comportement mobile (formulaire
toujours visible d'emblée, jamais d'interstitiel) ; `forgot-password`/
`reset-password` strictement inchangés (aucune ligne de leur branche de
rendu — le cas `!animatedIntro` — n'a été touchée).

**Vérifications, parcours réel (Playwright headless, comptes de test
réels, installé temporairement `--no-save` puis désinstallé après
usage)** :
- Chargement initial : fond bleu couvrant exactement tout le viewport
  (1440×900), filigrane nettement plus visible qu'avant, logo/titre/
  accroche/bouton lisibles et centrés.
- Clic sur "Se connecter" → carte blanche centrée apparaît par-dessus le
  MÊME fond bleu, sans le moindre changement de ses dimensions (0px
  d'écart mesuré) ni de la hauteur totale de la page.
- Connexion avec identifiants invalides (carte déjà révélée) → bannière
  d'erreur affichée sur la carte, toujours centrée, pas de retour au hero ;
  connexion avec identifiants valides → redirection réelle vers `/`.
- Session fraîche sans paramètre d'URL, puis F5 → bouton "Se connecter"
  visible dans les deux cas (retour à l'état hero confirmé, pas de
  mémorisation intempestive).
- Activation clavier : `Tab` atteint le bouton en 1 saut, `Entrée` révèle
  la carte exactement comme un clic, sans bulle de validation HTML5
  parasite (comportement déjà corrigé sur l'ancienne disposition, reconfirmé
  ici).
- Mobile (390px) : carte directement visible, bouton du hero absent, pas
  de scroll horizontal, connexion valide fonctionne normalement depuis
  mobile.
- `/forgot-password` et `/reset-password` (y compris son état "lien
  invalide") rechargés et confirmés visuellement identiques à avant cette
  tâche par capture d'écran.
- Aucune erreur JavaScript capturée dans la console sur l'ensemble du
  parcours.
- `tsc --noEmit`, `eslint` et un vrai `next build` (65 routes) passent
  sans erreur.

## Monorepo backend/frontend

```
sim-portail/
├── package.json          # racine, workspaces ["backend", "frontend"]
├── .env                   # UNIQUE, partagé (Docker Compose + les deux packages)
├── backend/
│   ├── prisma/              # schema.prisma, migrations/, seed.ts, set-admin.ts
│   └── src/
│       ├── index.ts           # point d'entrée principal (réexporte tout)
│       ├── client-safe.ts     # sous-chemin "backend/client" — valeurs sûres pour un Client Component
│       ├── permissions.ts     # hasPermission / isAdmin / getAccessibleModules
│       ├── tresorerie.ts, reporting.ts, dashboardFinance.ts, ...
│       └── generated/prisma/  # généré (gitignored)
└── frontend/
    ├── next.config.ts       # outputFileTracingRoot + transpilePackages: ["backend"]
    └── src/
        ├── app/               # pages, Server Actions, routes API
        ├── components/, types/
        └── lib/
            ├── auth.ts, auth.config.ts, proxy.ts (middleware)
            ├── eventBus.ts, events.ts, notifications.ts  # SSE (reste en frontend, jamais backend)
            └── pdf/                # @react-pdf/renderer (reste en frontend, process.cwd() fragile ailleurs)
```

**Règle de sens de dépendance : toujours `frontend → backend`, jamais
l'inverse.** `backend/` ne contient que de la logique métier pure (aucun
import `next`/`react`) — tout fichier qui dépend de Next.js/NextAuth
(`auth.ts`, `auth.config.ts`, le middleware, le SSE, `pdf/`) reste en
`frontend/` même s'il vit sous un dossier `lib/`.

**`backend/src/client-safe.ts`** — un Client Component qui importe une
**valeur** (pas un type) depuis `"backend"` (le point d'entrée principal)
entraînerait tout le graphe de `index.ts`, y compris le singleton Prisma et
`pg`, dans le bundle navigateur (`Module not found: Can't resolve 'tls'`).
Tout Client Component doit importer ses valeurs (`IDLE_ACTION_STATE`,
enums Prisma, etc.) depuis **`"backend/client"`**, jamais `"backend"`. Les
imports de **types** (`import type { ... } from "backend"`) n'ont pas ce
problème (effacés à la compilation).

`.env` reste à la racine (lu nativement par Docker Compose et par
`backend/` via `dotenv` + chemin `__dirname`) ; `frontend/package.json` en
copie une version jetable vers `frontend/.env` avant chaque `dev`/`build`/
`start` (scripts `predev`/`prebuild`/`prestart`) pour que Next.js le
charge par son propre mécanisme natif — `@next/env` chargé depuis
`next.config.ts` ne se propage pas de façon fiable au runtime.

## Déploiement Docker / Dokploy

Guide complet : [DEPLOIEMENT.md](DEPLOIEMENT.md). Image construite
(GHCR), déployée sur Dokploy via `docker-compose.raw.yml` (mode « Raw »,
pas de build côté Dokploy).

- **Migrations automatiques (`prisma migrate deploy`) à chaque démarrage,
  seed JAMAIS automatisé** — le seed fait des `deleteMany`, protégé par un
  marqueur `.seeded` sur le volume `uploads` en production ; un service
  `init` one-shot l'exécute une seule fois puis lance
  `backend/prisma/set-admin.ts` (idempotent), avant que le service `app`
  ne démarre.
- Service de base de données nommé **`portailrh-db`** — jamais `db`
  (réseau `dokploy-network` partagé entre tous les projets du serveur,
  ambiguïté DNS sinon).
- **Structure `standalone/` copiée telle quelle** dans l'image (jamais
  aplatie) — `CMD ["node", "frontend/server.js"]`. Aplatir casse les liens
  symboliques relatifs de Turbopack vers `@prisma/client`/`pg`/
  `@react-pdf/renderer` (HTTP 500 sur toute route touchant Prisma).
  Conséquence : `process.cwd()` au runtime vaut `/app/frontend`, pas
  `/app` — les chemins basés dessus (polices PDF, `uploads/`) en tiennent
  compte.
- Volume `uploads` monté sur `/app/uploads`, lié par un lien symbolique
  depuis `/app/frontend/uploads` pour la persistance des pièces jointes.
- **Limite connue, non corrigée** : les photos de profil
  (`api/upload-photo`) s'écrivent dans `public/uploads/profiles`, hors
  volume — perdues à chaque redéploiement.
- Aucun dossier généré (Prisma ou autre) ne doit jamais être commité —
  `.gitignore` racine porte un motif générique `**/generated/prisma/`.

## Aide-mémoire — permissions actuelles

**Trésorerie** (`treso.*`) : `creer_demande`, `declarer_retour`,
`categoriser_demande`, `valider_demande`, `effectuer_reglement`,
`receptionner_retour`, `cloturer_demande`, `saisir_depense_directe`,
`alimenter_caisse`, `corriger_solde_ouverture`, `voir_dashboard_finance`,
`voir_reporting`, `approuver_validation_complete`, `gerer_categories`.
`alimenter_caisse`/`corriger_solde_ouverture` isolées depuis "Séparation
Responsable Finance / Assistant Finance" (voir plus bas) — avant cette
tâche, `alimenterCaisseAction`/`definirSoldeOuvertureAction`/
`corrigerSoldeOuvertureAction` partageaient toutes les trois la garde de
`effectuer_reglement`, jamais des permissions dédiées.

**Pointage RH** (`pointage.*`) : `pointer`, `consulter_historique`,
`consulter_tous`, `pointage_exceptionnel`, `corriger_pointage`,
`gerer_horaires`, `voir_dashboard_rh`, `voir_reporting`.

**Champs de rôle transverses** (jamais un nom de rôle en dur) :
`Role.estAdmin` (accès `/admin`, figé à la création),
`Role.peutEtreBeneficiaireDelegation` (éligibilité comme bénéficiaire
d'une délégation, librement modifiable — deux cas explicites l'ont à
`true` par défaut : « Collaborateur » et « Assistant Finance », voir
"Délégation individuelle de permissions").

`treso/finance/layout.tsx` (espace Finance partagé) accepte l'union de
toutes les permissions `treso.*` opérationnelles ci-dessus (sauf
`creer_demande`/`declarer_retour`, réservées au Collaborateur) : toute
nouvelle permission Trésorerie qui doit donner accès à cet espace doit être
ajoutée à cette garde OR — `alimenter_caisse`/`corriger_solde_ouverture` y
ont été ajoutées dès leur création (Tâche "Séparation Responsable Finance
/ Assistant Finance"), même si `effectuer_reglement`/`receptionner_retour`
suffisent déjà en pratique à admettre le seul rôle qui les possède
aujourd'hui (Assistant Finance) — appliqué par principe, pas par nécessité
immédiate.

**Bug corrigé (Tâche "Séparer 'valider' de 'régler/décaisser'")** :
`treso.effectuer_reglement` manquait de cette garde OR depuis l'origine —
invisible tant que seul le rôle Finance (qui porte aussi
`categoriser_demande`/`valider_demande`/etc.) y accédait, mais bloquant
`Vous n'avez pas accès à l'espace Finance des demandes` pour tout compte
délégataire ne détenant QUE `effectuer_reglement` (le scénario même que la
délégation individuelle est censée permettre — voir "Délégation
individuelle de permissions"). Découvert par vérification pratique d'une
délégation "règlement seul", corrigé en ajoutant la permission à la garde.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
