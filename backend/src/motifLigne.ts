// Motif par ligne d'achat (2026-10-09) : chaque ligne porte son motif (pourquoi cet article). Les anciennes demandes
// gardent leur motif d'en-tête (`Demande.description`), affiché en lecture seule ; leurs lignes n'ont pas de motif.
// Fichier PUR, sûr pour un Client Component.

/** Longueur minimale d'un motif de ligne (comme l'ancien motif d'en-tête). */
export const MOTIF_LIGNE_MIN = 3;

/** Message de refus d'un motif de ligne, ou `null` s'il est valide. */
export function refusMotifLigne(motif: string | null | undefined): string | null {
  return (motif ?? "").trim().length >= MOTIF_LIGNE_MIN
    ? null
    : `Chaque ligne doit avoir un motif (${MOTIF_LIGNE_MIN} caractères minimum).`;
}

/** Motif d'une ligne tel que le demandeur l'a écrit en dernier (même règle que le libellé). */
export function motifLigneDemandeur(l: { motif: string | null; motifOriginal: string | null; motifDemandeur: string | null }): string | null {
  return l.motifDemandeur ?? l.motifOriginal ?? l.motif;
}

/**
 * Motif résumé d'une demande pour les listes : l'ancien motif d'en-tête s'il existe (anciennes demandes, dépense
 * directe), sinon les motifs de ses lignes (« libellé : motif »).
 */
export function resumeMotifDemande(description: string | null, lignes: { libelle: string; motif: string | null }[]): string {
  if (description) return description;
  const parts = lignes.filter((l) => l.motif).map((l) => `${l.libelle} : ${l.motif}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
