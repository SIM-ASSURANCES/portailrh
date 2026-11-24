import type { IconName } from "@/components/icons";

/**
 * Rubriques du module Gestion Compta, dans l'ordre du plan (docs/compta-conception.md §10). Source unique : elles forment la
 * barre latérale (le module n'a plus de page d'accueil). Une rubrique n'apparaît que pour un compte qui a au moins une des
 * permissions listées (aucune permission listée = tout compte qui consulte le module) ; `href` absent = écran pas encore construit,
 * affiché « Bientôt disponible » dans la barre. Fichier PUR (aucun accès à la session) : le calcul des rubriques visibles se fait
 * côté serveur, dans `(dashboard)/layout.tsx`, avec `hasPermission`.
 */
export interface RubriqueCompta {
  /** Identifiant stable, passé du serveur à la barre latérale. */
  cle: string;
  label: string;
  icon: IconName;
  permissions: string[];
  href?: string;
  /** Lot du plan qui construira l'écran (information, non affichée dans la barre). */
  lot: string;
}

export const RUBRIQUES_COMPTA: readonly RubriqueCompta[] = [
  { cle: "referentiels", label: "Référentiels", icon: "book-text", permissions: [], href: "/compta/referentiels", lot: "GC-2" },
  {
    cle: "production",
    label: "Production",
    icon: "file-text",
    permissions: ["cpt.importer_production", "cpt.saisir_contrat"],
    href: "/compta/production",
    lot: "GC-3",
  },
  {
    cle: "encaissements",
    label: "Encaissements",
    icon: "wallet",
    permissions: ["cpt.importer_releves", "cpt.identifier_encaissement", "cpt.classer_pas_une_prime"],
    href: "/compta/encaissements",
    lot: "GC-4",
  },
  {
    cle: "rattachements",
    label: "Rattachements",
    icon: "check-circle",
    permissions: ["cpt.confirmer_rattachement", "cpt.valider_rattachement"],
    href: "/compta/rattachements",
    lot: "GC-5",
  },
  {
    cle: "controle",
    label: "Contrôle hebdomadaire",
    icon: "clock",
    permissions: [],
    href: "/compta/controle",
    lot: "GC-6",
  },
  { cle: "clients", label: "Clients", icon: "users", permissions: [], href: "/compta/clients", lot: "GC-7a" },
  { cle: "creances", label: "Créances et relances", icon: "alert-triangle", permissions: ["cpt.relancer"], lot: "GC-6 et GC-7" },
  { cle: "tca", label: "Taxe sur les contrats d'assurance", icon: "scroll-text", permissions: ["cpt.declarer_tca", "cpt.payer_tca"], lot: "GC-8" },
  {
    cle: "partenaires",
    label: "Partenaires",
    icon: "users",
    permissions: ["cpt.gerer_conventions", "cpt.regler_partenaire", "cpt.compenser"],
    lot: "GC-2 et GC-9",
  },
  { cle: "odoo", label: "Comptabilité (Odoo)", icon: "book-text", permissions: ["cpt.preparer_ecritures"], lot: "GC-10" },
  { cle: "cloture", label: "Clôture du mois", icon: "shield-check", permissions: ["cpt.cloturer_periode"], lot: "GC-10" },
  { cle: "litiges", label: "Litiges", icon: "info", permissions: ["cpt.trancher_litige"], lot: "à préciser" },
  { cle: "parametres", label: "Paramètres", icon: "settings", permissions: ["cpt.parametrer"], href: "/compta/parametres", lot: "GC-3i" },
];

/** Clés des rubriques visibles pour un compte, d'après sa fonction de test de permission. */
export function rubriquesComptaVisibles(aLaPermission: (permission: string) => boolean): string[] {
  return RUBRIQUES_COMPTA.filter((r) => r.permissions.length === 0 || r.permissions.some(aLaPermission)).map((r) => r.cle);
}
