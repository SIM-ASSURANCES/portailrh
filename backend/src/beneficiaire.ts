import type { BeneficiaireType } from "./generated/prisma/client";

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

/**
 * Champ « Bénéficiaire » du formulaire de demande d'achat (2026-10-09, remplace la liste « Entité bénéficiaire ») :
 * moi-même (par défaut), un autre compte actif du portail, ou un nom libre.
 */
export type ChoixBeneficiaire =
  | { mode: "MOI" }
  | { mode: "COMPTE"; userId: string }
  | { mode: "NOM"; nom: string };

const normaliserNom = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Noms libres reconnus comme l'entreprise elle-même (type ENTREPRISE) ; tout autre nom est un FOURNISSEUR. */
const NOMS_ENTREPRISE = new Set(["sim assurances", "sim assurances ci", "sim assurance", "sim assurance ci"]);

/**
 * Les trois champs existants du bénéficiaire d'une demande, à partir du choix. Un compte (moi-même ou un autre) donne
 * le type COLLABORATEUR : aucun profil ne distingue un stagiaire sur un compte du portail. Un nom libre donne un type
 * externe : ENTREPRISE pour « SIM Assurances (CI) », sinon FOURNISSEUR. Jamais un compte ET un nom à la fois.
 */
export function champsBeneficiaire(
  choix: ChoixBeneficiaire,
  createurId: string
): { beneficiaireType: BeneficiaireType; beneficiaireUserId: string | null; beneficiaireNom: string | null } {
  if (choix.mode === "MOI") return { beneficiaireType: "COLLABORATEUR", beneficiaireUserId: createurId, beneficiaireNom: null };
  if (choix.mode === "COMPTE") return { beneficiaireType: "COLLABORATEUR", beneficiaireUserId: choix.userId, beneficiaireNom: null };
  const nom = choix.nom.trim();
  return {
    beneficiaireType: NOMS_ENTREPRISE.has(normaliserNom(nom)) ? "ENTREPRISE" : "FOURNISSEUR",
    beneficiaireUserId: null,
    beneficiaireNom: nom,
  };
}
