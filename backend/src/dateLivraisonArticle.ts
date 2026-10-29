// Date de livraison PAR ARTICLE (lot G, 2026-10-14). Module PUR, sûr pour un Client Component.
//
// `Demande.dateLivraisonSouhaitee` reste la date COMMUNE de la demande (déjà une date de livraison : aucun second champ
// « date commune » n'est créé). Chaque article a en plus sa propre date (`LigneDemande.dateLivraison`). À l'enregistrement,
// un article sans date propre reçoit la date commune, COPIÉE : la valeur stockée est toujours explicite, jamais un
// héritage calculé à l'affichage — un article antérieur au lot G reste donc vide et s'affiche « — », sans reprise.

export const MESSAGE_DATE_LIVRAISON_INVALIDE = "Date de livraison invalide.";
export const MESSAGE_DATE_LIVRAISON_PASSEE = "La date de livraison ne peut pas être dans le passé.";

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Date du jour au format `YYYY-MM-DD` (même convention que les autres contrôles de date du module). */
export function jourCourant(maintenant: Date = new Date()): string {
  return maintenant.toISOString().slice(0, 10);
}

/** Refus éventuel d'une date de livraison saisie (`null` si vide ou valide). La date du jour reste autorisée. */
export function refusDateLivraison(valeur: string | null | undefined, aujourdhui: string = jourCourant()): string | null {
  const v = (valeur ?? "").trim();
  if (!v) return null;
  if (!FORMAT_JOUR.test(v) || Number.isNaN(Date.parse(v))) return MESSAGE_DATE_LIVRAISON_INVALIDE;
  return v < aujourdhui ? MESSAGE_DATE_LIVRAISON_PASSEE : null;
}

/** Date à enregistrer pour un article : la sienne, sinon la date commune, sinon rien. */
export function dateLivraisonAEnregistrer(propre: string | null | undefined, commune: string | null | undefined): string | null {
  const p = (propre ?? "").trim();
  if (p) return p;
  const c = (commune ?? "").trim();
  return c || null;
}

/** Valeur à stocker (`Date` UTC minuit, colonne `DATE`) ou `null`. */
export function versDateStockee(jour: string | null | undefined): Date | null {
  return jour ? new Date(`${jour}T00:00:00.000Z`) : null;
}

/** `YYYY-MM-DD` d'une date stockée (champ `<input type="date">`), vide si absente. */
export function jourDepuisDate(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** Affichage d'une date de livraison : « 12/10/2026 », ou « — » pour un article sans date (ancien article). */
export function libelleDateLivraison(d: Date | null | undefined): string {
  if (!d) return "—";
  const [a, m, j] = d.toISOString().slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}
