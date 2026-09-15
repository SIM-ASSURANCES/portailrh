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

### Catégorisation Finance : jamais de redirection après succès

`CategorisationForm.tsx` (`/treso/finance/demandes/[id]`) **reste toujours
sur l'écran de traitement** après un enregistrement réussi — jamais de
`router.push` vers la liste. `categoriserDemandeAction` ne change jamais
`statut` (la demande reste `EN_ATTENTE_VALIDATION`) : le `revalidatePath`
qu'elle appelle suffit à réafficher ce même formulaire, désormais
pré-rempli avec la catégorie/l'objet qui viennent d'être enregistrés, avec
`ValidationActions` toujours visible juste en dessous sur la même page —
Finance peut enchaîner catégoriser puis valider sans changer d'écran.

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

## Module Pointage RH — état actuel

Module distinct, maintenu principalement par un autre binôme
(`origin/thierry-kouame`) — cette section documente uniquement
l'intégration côté Socle (nav, permissions, dashboard), pas la logique
métier détaillée du module.

Modèles : `ParametrageHoraire` (horaires de référence), `Pointage`
(arrivée/départ, source `QR_CODE`/`ORDINATEUR`/`RH_EXCEPTIONNEL`),
`CorrectionPointage` (trace obligatoire de toute correction — jamais
d'édition silencieuse), `Absence` (statut `A_CONTROLER`/`CONFIRMEE`/
`JUSTIFIEE`).

Module `pointage`, 8 permissions (`pointer`, `consulter_historique`,
`consulter_tous`, `pointage_exceptionnel`, `corriger_pointage`,
`gerer_horaires`, `voir_dashboard_rh`, `voir_reporting`). Répartition :
Collaborateur → `pointer`+`consulter_historique` ; RH → les 8 ; DG →
lecture seule (`consulter_tous`/`voir_dashboard_rh`/`voir_reporting`) ;
Admin → aucune (accès via `isAdmin()`).

Un ordinateur ne peut pointer que depuis une IP listée dans
`ALLOWED_OFFICE_IPS` (env var, contrôlée aussi côté Server Action) ; un
téléphone n'est pas soumis à cette restriction.

Routes réelles construites à ce jour : `/pointage/pointer` (+ alias
`/pointage`), `/pointage/historique`, `/pointage/rh` (présence du jour),
`/pointage/rh/generer-qr`. D'autres écrans RH (pointages, retards,
reporting, corrections, horaires) ont depuis reçu du code
(`pointage/rh/absences/actions.ts`, `.../corrections/actions.ts`,
`.../horaires/actions.ts`, `.../pointages/nouveau/actions.ts` existent) —
**l'état exact de ce qui est réellement navigable est à vérifier dans le
code au moment de travailler dessus**, ce module évoluant indépendamment
de cette documentation (section signalée comme possiblement datée). La
nav (`hasPointageAccess`/`canAccessPointageRH`) et le dashboard général
marquent `comingSoon: true` tout écran encore sans route réelle plutôt que
de proposer un lien mort.

Notifications Pointage RH (retards/absences aux RH, pointage
exceptionnel/régularisation au collaborateur) utilisent le même mécanisme
générique que la Trésorerie (`createNotification`/SSE).

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
confirmée : la Direction modère aussi, au même titre que RH). Vérifiée en
base après ajout : la permission est bien assignée aux deux rôles, à
aucun autre. Vérifiée aussi **en pratique** via une vraie connexion (compte
DG réel, JWT réel, `getSession()` réel avec sa jointure Prisma
rôle→permissions) : `session.permissions` contient bien `feedback.moderer`
pour ce compte — c'est exactement le tableau que `hasPermission()`
consultera dès qu'un écran de modération existera (aucun écran construit
à ce stade, Tranche A seulement). Aucune autre logique du projet ne
suppose que seul RH la possède : seul `seed.ts` référence cette clé, aucun
composant/action ne compare `role.name === "RH"` en dur pour ce module.

### Décisions confirmées

- **Destinataires proposables** (`getFeedbackRecipients`,
  `backend/src/feedback.ts`) : **tous** les `User` actifs du portail, sans
  restriction de rôle — confirmé, ne pas restreindre.
- **Destinataire jamais affiché publiquement** (`getPublicFeedbacks`) : la
  vue publique (`/feedback`) ne montre que le contenu et la date (arrondie
  au jour) des messages `source: PUBLIC` non modérés — confirmé, ne pas
  changer.

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
  détermine qui peut être choisi comme bénéficiaire. Seul le rôle
  « Collaborateur » l'a à `true` par défaut (seed + migration de
  rattrapage) ; jamais déduit d'un nom de rôle en dur.
- `revoquerDelegationAction` : le donneur d'origine, **ou** un Admin
  (`/admin/delegations`, vue de toutes les délégations tous donneurs
  confondus).
- Un compte ayant accordé ou reçu au moins une délégation (active ou
  révoquée) ne peut plus être supprimé définitivement (voir plus bas),
  seulement désactivé.

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
`voir_dashboard_finance`, `voir_reporting`, `approuver_validation_complete`,
`gerer_categories`.

**Pointage RH** (`pointage.*`) : `pointer`, `consulter_historique`,
`consulter_tous`, `pointage_exceptionnel`, `corriger_pointage`,
`gerer_horaires`, `voir_dashboard_rh`, `voir_reporting`.

**Champs de rôle transverses** (jamais un nom de rôle en dur) :
`Role.estAdmin` (accès `/admin`, figé à la création),
`Role.peutEtreBeneficiaireDelegation` (éligibilité comme bénéficiaire
d'une délégation, librement modifiable).

`treso/finance/layout.tsx` (espace Finance partagé) accepte l'union de
toutes les permissions `treso.*` opérationnelles ci-dessus (sauf
`creer_demande`/`declarer_retour`, réservées au Collaborateur) : toute
nouvelle permission Trésorerie qui doit donner accès à cet espace doit être
ajoutée à cette garde OR.

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
