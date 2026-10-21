/** Plage de congé du collaborateur, en jours civils `YYYY-MM-DD` (bornes incluses). */
export type PlageCongeCalendrier = {
  id: string;
  debut: string;
  fin: string;
  etat: "valide" | "demande";
};

export type PlageDuJour = {
  id: string;
  etat: PlageCongeCalendrier["etat"];
  estDebut: boolean;
  estFin: boolean;
};

/**
 * Plage qui couvre le jour donné (`YYYY-MM-DD`), ou `null`.
 * Comparaison de chaînes ISO (pas d'objet `Date` : aucun décalage de fuseau).
 * En cas de chevauchement, une plage validée l'emporte sur une demande.
 */
export function plageDuJour(jour: string, plages: readonly PlageCongeCalendrier[]): PlageDuJour | null {
  let retenue: PlageCongeCalendrier | null = null;
  for (const p of plages) {
    if (jour < p.debut || jour > p.fin) continue;
    if (!retenue || (p.etat === "valide" && retenue.etat !== "valide")) retenue = p;
  }
  if (!retenue) return null;
  return { id: retenue.id, etat: retenue.etat, estDebut: jour === retenue.debut, estFin: jour === retenue.fin };
}

