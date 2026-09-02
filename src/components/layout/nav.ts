import type { IconName } from "@/components/icons";

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /**
   * Force une correspondance exacte (pas de préfixe) pour l'état "actif".
   * Nécessaire dès qu'un item est le préfixe strict d'un autre item de la
   * même sidebar (ex: "/treso/finance" préfixe de "/treso/finance/demandes")
   * — sans quoi les deux s'allumeraient simultanément sur une sous-route.
   */
  exact?: boolean;
  /**
   * Aucun écran construit à `href` pour l'instant (Module Pointage RH :
   * fondations de données seulement, voir CLAUDE.md) — l'item reste visible
   * pour annoncer la fonctionnalité aux rôles concernés, mais rendu non
   * cliquable ("Bientôt disponible") plutôt qu'un lien mort vers une 404.
   */
  comingSoon?: boolean;
}

export interface NavGroup {
  /** Sous-titre de groupe à l'intérieur d'une branche (facultatif). */
  title?: string;
  items: NavItem[];
}

export interface NavBranch {
  key: string;
  label: string;
  icon: IconName;
  groups: NavGroup[];
}

/**
 * Entrée de navigation hors branche, épinglée en haut de la sidebar.
 */
export const DASHBOARD_ITEM: NavItem = {
  label: "Tableau de bord",
  href: "/",
  icon: "layout-grid",
};

/**
 * Permissions/rôles conditionnant l'affichage de certaines entrées de la
 * navigation (calculées côté serveur, cf. `(dashboard)/layout.tsx`, puis
 * passées en booléens jusqu'à la Sidebar — jamais de logique de permission
 * dans ce fichier, purement statique et sans accès à la session).
 */
export interface NavFlags {
  /** `treso.creer_demande` OU `treso.declarer_retour` : ajoute "Demandes" (espace Collaborateur). */
  canAccesDemandes: boolean;
  canAccesFinanceDemandes: boolean;
  /** `treso.receptionner_retour` : ajoute "Retours en attente" (Finance). */
  canReceptionnerRetour: boolean;
  /** `treso.voir_dashboard_finance` : ajoute "Tableau de bord Finance" (en tête de branche). */
  canVoirDashboardFinance: boolean;
  /** `treso.voir_reporting` : ajoute "Reporting". */
  canVoirReporting: boolean;
  /** `treso.saisir_depense_directe` (Phase F) : ajoute "Nouvelle dépense directe". */
  canSaisirDepenseDirecte: boolean;
  /** `pointage.*` : affiche la section RH du pointage. */
  canAccessPointageRH: boolean;
  /**
   * Au moins une permission `pointage.*` : affiche la branche "Pointage de
   * Présence" (sinon masquée entièrement — aucune permission de ce module
   * ne rend la branche pertinente). Tous ses items restent `comingSoon`
   * quelle que soit la permission tant qu'aucun écran n'est construit.
   */
  hasPointageAccess: boolean;
}

/**
 * Les deux branches fonctionnelles du portail. Chaque branche est un
 * accordéon dans la sidebar (déployée) ou un bloc d'icônes séparé par un
 * filet (sidebar réduite). Une branche entièrement vide pour la session
 * (aucun item gagné par ses permissions) n'est jamais retournée — mieux
 * vaut l'absence totale de la branche qu'un accordéon vide ou rempli
 * d'items sans rapport avec le rôle (audit habilitations, voir CLAUDE.md).
 *
 * - « Demande d'Achat » : circuit demande → règlement → trésorerie. Chaque
 *   item correspond à une permission précise, jamais affiché sans elle —
 *   les anciens items non gardés ("Règlements", "Retours de caisse",
 *   "Journal de caisse", "Catégories", "Objets" à la racine) ont été
 *   retirés : c'étaient des stubs de maquette du Ticket 1 pointant vers des
 *   routes qui n'ont jamais été construites sous cette forme, la fonction
 *   réelle ayant fini par vivre ailleurs (inline dans le détail d'une
 *   demande, ou sous `/treso/finance/*`) — pas des fonctionnalités "à
 *   venir", du vrai code mort.
 * - « Pointage de Présence » : visible uniquement si la session a au moins
 *   une permission `pointage.*` (`hasPointageAccess`), mais CHAQUE item
 *   reste `comingSoon` quelle que soit la permission : aucun écran n'existe
 *   encore pour ce module (fondations de données seulement), donc aucun
 *   lien ne doit jamais résoudre vers une page inexistante.
 */
export const NAV_BRANCHES: NavBranch[] = [
  {
    key: "achat",
    label: "Demande d'Achat",
    icon: "shopping-cart",
    groups: [
      {
        items: [
          { label: "Demandes", href: "/demandes", icon: "file-text" },
          { label: "Règlements", href: "/reglements", icon: "wallet" },
          { label: "Retours de caisse", href: "/retours", icon: "rotate-ccw" },
        ],
      },
      {
        title: "Trésorerie",
        items: [
          { label: "Journal de caisse", href: "/journal", icon: "book-text" },
          { label: "Catégories", href: "/categories", icon: "folder-tree" },
          { label: "Objets", href: "/objets", icon: "package" },
        ],
      },
    ],
  },
];
export function getNavBranches({
  canAccesDemandes,
  canAccesFinanceDemandes,
  canReceptionnerRetour,
  canVoirDashboardFinance,
  canVoirReporting,
  canSaisirDepenseDirecte,
  canAccessPointageRH,
  hasPointageAccess,
}: NavFlags): NavBranch[] {
  const branches: NavBranch[] = [
    {
      key: "achat",
      label: "Demande d'Achat",
      icon: "shopping-cart",
      groups: [
        {
          items: [
            ...(canVoirDashboardFinance
              ? [
                  {
                    label: "Tableau de bord Finance",
                    href: "/treso/finance",
                    icon: "layout-grid",
                    exact: true,
                  } satisfies NavItem,
                ]
              : []),
            ...(canAccesDemandes
              ? [
                  {
                    label: "Mon tableau de bord",
                    href: "/treso/tableau-de-bord",
                    icon: "layout-grid",
                    exact: true,
                  } satisfies NavItem,
                  { label: "Demandes", href: "/treso/demandes", icon: "file-text" } satisfies NavItem,
                ]
              : []),
            ...(canSaisirDepenseDirecte
              ? [
                  {
                    label: "Nouvelle dépense directe",
                    href: "/treso/finance/depenses-directes/nouvelle",
                    icon: "plus-circle",
                  } satisfies NavItem,
                ]
              : []),
            ...(canAccesFinanceDemandes
              ? [
                  {
                    label: "Demandes en attente de validation",
                    href: "/treso/finance/demandes",
                    icon: "folder-tree",
                  } satisfies NavItem,
                ]
              : []),
            ...(canReceptionnerRetour
              ? [
                  {
                    label: "Retours en attente",
                    href: "/treso/finance/retours",
                    icon: "rotate-ccw",
                  } satisfies NavItem,
                ]
              : []),
            ...(canVoirReporting
              ? [
                  {
                    label: "Reporting",
                    href: "/treso/finance/reporting",
                    icon: "download",
                  } satisfies NavItem,
                ]
              : []),
          ],
        },
      ],
    },
    {
      key: "pointage",
      label: "Pointage de Présence",
      icon: "clock",
      groups: [
        {
          items: [
            { label: "Pointer", href: "/pointage/pointer", icon: "qr-code" },
            { label: "Mon historique", href: "/pointage/historique", icon: "book-text" },
          ],
        },
        ...(canAccessPointageRH
          ? [
              {
                title: "RH",
                items: [
                  { label: "Boîte à Outils", href: "/pointage/rh", icon: "layout-grid", exact: true },
                  { label: "Présence du jour", href: "/pointage/rh/presence", icon: "check-circle", exact: true },
                  { label: "Tous les pointages", href: "/pointage/rh/pointages", icon: "file-text", exact: true },
                  { label: "Retards & absences", href: "/pointage/rh/absences", icon: "alert-triangle" },
                ],
              } satisfies NavGroup,
            ]
          : []),
      ],
    },
  ];

  if (!hasPointageAccess) {
    branches.splice(
      branches.findIndex((b) => b.key === "pointage"),
      1
    );
  }

  return branches.filter((branch) => branch.groups.some((group) => group.items.length > 0));
}

/**
 * Console d'administration du Socle (réservée au rôle Admin, cf.
 * `isAdmin()`). Rendue en section à plat au bas de la sidebar, uniquement
 * quand la session est administratrice.
 */
export const ADMIN_GROUP: NavGroup = {
  title: "Administration",
  items: [
    { label: "Vue d'ensemble", href: "/admin", icon: "layout-grid", exact: true },
    { label: "Utilisateurs", href: "/admin/users", icon: "users" },
    { label: "Rôles & permissions", href: "/admin/roles", icon: "shield-check" },
    { label: "Modules", href: "/admin/modules", icon: "package" },
    { label: "Catégories", href: "/admin/categories", icon: "folder-tree" },
  ],
};
