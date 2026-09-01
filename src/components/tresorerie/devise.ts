/**
 * Devises acceptées par le formulaire "Demande d'Achat". Le code ISO est
 * stocké tel quel dans `Demande.devise` (défaut "XOF"). Liste volontairement
 * courte en V1 — étendre ici si le besoin apparaît.
 */
export const DEVISE_OPTIONS = [
  { value: "XOF", label: "Franc CFA (XOF)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "USD", label: "Dollar US (USD)" },
] as const;

export const DEVISE_CODES = DEVISE_OPTIONS.map((d) => d.value);

export type DeviseCode = (typeof DEVISE_OPTIONS)[number]["value"];

/**
 * Formate un montant pour l'affichage : "1 234 567 FCFA" pour la devise
 * locale (`XOF` → libellé usuel « FCFA »), "1 234 567 EUR" sinon.
 */
export function formatMontantDevise(montant: number, devise: string): string {
  const suffixe = devise === "XOF" ? "FCFA" : devise;
  return `${montant.toLocaleString("fr-FR")} ${suffixe}`;
}
