import type { BeneficiaireType } from "@/generated/prisma/client";

/**
 * Libellés humains de `BeneficiaireType` (Phase A), partagés par le
 * formulaire de saisie directe (Phase F) et l'affichage du bénéficiaire
 * sur les écrans de détail/listes — même principe que `demandeStatut.ts`
 * pour `StatutDemande`.
 */
export const BENEFICIAIRE_TYPE_LABEL: Record<BeneficiaireType, string> = {
  COLLABORATEUR: "Collaborateur",
  STAGIAIRE: "Stagiaire",
  FOURNISSEUR: "Fournisseur / prestataire",
  ENTREPRISE: "SIM Assurances CI",
};

export const BENEFICIAIRE_TYPE_OPTIONS = (
  Object.entries(BENEFICIAIRE_TYPE_LABEL) as [BeneficiaireType, string][]
).map(([value, label]) => ({ value, label }));

/**
 * Nom d'affichage du bénéficiaire d'une Demande : le nom de l'utilisateur
 * du système si `beneficiaireUserId` est renseigné, sinon le texte libre
 * `beneficiaireNom`, sinon un tiret. Même règle de résolution que le bon
 * de caisse (Phase E, `route.tsx` du bon de caisse) — factorisée ici pour
 * ne jamais la dupliquer sur les écrans qui affichent un bénéficiaire.
 */
export function getBeneficiaireNom(demande: {
  beneficiaireUser: { fullName: string } | null;
  beneficiaireNom: string | null;
}): string {
  return demande.beneficiaireUser?.fullName ?? demande.beneficiaireNom ?? "—";
}
