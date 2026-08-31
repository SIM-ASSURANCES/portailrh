import type { NatureDepenseDirecte, TypeDemande } from "@/generated/prisma/client";

/**
 * Libellés humains de `NatureDepenseDirecte` (Phase F, cahier des charges
 * section 11), partagés par le formulaire de saisie directe et son
 * affichage (badge "Dépense directe" + nature) sur les listes/détails.
 */
export const NATURE_DEPENSE_DIRECTE_LABEL: Record<NatureDepenseDirecte, string> = {
  PRIME_STAGE: "Prime de stage",
  DOTATION_CARBURANT: "Dotation carburant",
  DEPENSE_ENTREPRISE: "Dépense pour l'entreprise",
  DEPENSE_COLLECTIVE: "Dépense collective / administrative",
  AUTRE: "Autre",
};

export const NATURE_DEPENSE_DIRECTE_OPTIONS = (
  Object.entries(NATURE_DEPENSE_DIRECTE_LABEL) as [NatureDepenseDirecte, string][]
).map(([value, label]) => ({ value, label }));

export const TYPE_DEMANDE_LABEL: Record<TypeDemande, string> = {
  STANDARD: "Standard",
  DEPENSE_DIRECTE: "Dépense directe",
};

export const TYPE_DEMANDE_OPTIONS = (
  Object.entries(TYPE_DEMANDE_LABEL) as [TypeDemande, string][]
).map(([value, label]) => ({ value, label }));
