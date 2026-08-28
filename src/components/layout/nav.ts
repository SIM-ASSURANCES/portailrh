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
  canAccesFinanceDemandes: boolean;
  /** `treso.receptionner_retour` : ajoute "Retours en attente" (Finance). */
  canReceptionnerRetour: boolean;
  /** `treso.voir_dashboard_finance` : ajoute "Tableau de bord Finance" (en tête de branche). */
  canVoirDashboardFinance: boolean;
}

/**
 * Les deux branches fonctionnelles du portail. Chaque branche est un
 * accordéon dans la sidebar (déployée) ou un bloc d'icônes séparé par un
 * filet (sidebar réduite).
 *
 * - « Demande d'Achat » : circuit demande → règlement → trésorerie.
 * - « Pointage de Présence » : pointage RH (voir cahier des charges V1).
 *
 * Les routes non encore implémentées renvoient un 404 tant que l'écran
 * correspondant n'existe pas — l'entrée fige la structure de navigation.
 */
export function getNavBranches({
  canAccesFinanceDemandes,
  canReceptionnerRetour,
  canVoirDashboardFinance,
}: NavFlags): NavBranch[] {
  return [
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
            { label: "Demandes", href: "/treso/demandes", icon: "file-text" },
            ...(canAccesFinanceDemandes
              ? [
                  {
                    label: "Demandes à traiter (Finance)",
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
    {
      key: "pointage",
      label: "Pointage de Présence",
      icon: "clock",
      groups: [
        {
          title: "Mon espace",
          items: [
            { label: "Pointer", href: "/pointage/pointer", icon: "qr-code" },
            { label: "Mon historique", href: "/pointage/historique", icon: "book-text" },
          ],
        },
        {
          title: "RH",
          items: [
            { label: "Présence du jour", href: "/pointage/rh", icon: "layout-grid" },
            { label: "Pointages", href: "/pointage/rh/pointages", icon: "file-text" },
            { label: "Retards & absences", href: "/pointage/rh/retards", icon: "alert-triangle" },
            { label: "Reporting", href: "/pointage/rh/reporting", icon: "download" },
            { label: "Corrections", href: "/pointage/rh/corrections", icon: "pencil" },
            { label: "Horaires", href: "/pointage/rh/horaires", icon: "settings" },
          ],
        },
      ],
    },
  ];
}

/**
 * Console d'administration du Socle (réservée au rôle Admin, cf.
 * `isAdmin()`). Rendue en section à plat au bas de la sidebar, uniquement
 * quand la session est administratrice.
 */
export const ADMIN_GROUP: NavGroup = {
  title: "Administration",
  items: [
    { label: "Vue d'ensemble", href: "/admin", icon: "layout-grid" },
    { label: "Utilisateurs", href: "/admin/users", icon: "users" },
    { label: "Rôles & permissions", href: "/admin/roles", icon: "shield-check" },
    { label: "Modules", href: "/admin/modules", icon: "package" },
  ],
};
