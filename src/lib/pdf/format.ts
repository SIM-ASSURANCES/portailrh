/**
 * Formate un montant en FCFA avec un espace ordinaire (U+0020) comme
 * séparateur de milliers — PAS `Number.toLocaleString("fr-FR")`, dont le
 * séparateur par défaut (espace fine insécable, U+202F) s'est révélé
 * absent des glyphes de la police Montserrat embarquée dans les PDF
 * (`registerFonts.ts`) : constaté en vérification manuelle (Phase E,
 * extraction de texte du bon de caisse via `pdftotext`) — le rendu
 * affichait "2000/ 00 FCFA" au lieu de "200 000 FCFA", le caractère
 * manquant perturbant le calcul des positions par le moteur de rendu.
 * Partagé par `ReceiptDocument.tsx` (Ticket 9) et
 * `BonDeCaisseDocument.tsx` (Phase E) pour ne jamais réintroduire ce piège.
 */
export function formatMontant(montant: number): string {
  const entier = Math.round(montant);
  const avecEspaces = entier.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${avecEspaces} FCFA`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}
