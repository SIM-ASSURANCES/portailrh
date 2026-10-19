// Motif / nature d'un règlement (lot I, 2026-10-19). L'Assistant Finance qui règle un article doit dire à quoi sert le
// règlement (caisse comme banque). Fonctions pures, partagées par les Server Actions (refus), les écrans (champ obligatoire,
// affichage), le reçu PDF, le parcours de l'article et le reporting.
//
// Les règlements antérieurs au lot I n'ont pas de motif (`null`) : ils ne sont JAMAIS bloqués ni modifiés, on affiche
// seulement « Non renseigné ».

/** Longueur minimale du motif d'un règlement (après suppression des espaces de bord). */
export const MOTIF_REGLEMENT_MIN = 5;
/** Longueur maximale (garde-fou, le champ est du texte libre). */
export const MOTIF_REGLEMENT_MAX = 300;

/** Texte affiché pour un règlement sans motif (ancien règlement). */
export const MOTIF_REGLEMENT_NON_RENSEIGNE = "Non renseigné";

export const MESSAGE_MOTIF_REGLEMENT_OBLIGATOIRE = `Le motif / la nature du règlement est obligatoire (${MOTIF_REGLEMENT_MIN} caractères minimum).`;

/** Motif nettoyé : espaces de bord supprimés, espaces internes multiples réduits. */
export function nettoyerMotifReglement(motif: string | null | undefined): string {
  return (motif ?? "").replace(/\s+/g, " ").trim();
}

/** Refus (phrase) si le motif d'un NOUVEAU règlement est absent, trop court ou trop long ; `null` s'il est valide. */
export function refusMotifReglement(motif: string | null | undefined): string | null {
  const m = nettoyerMotifReglement(motif);
  if (m.length < MOTIF_REGLEMENT_MIN) return MESSAGE_MOTIF_REGLEMENT_OBLIGATOIRE;
  if (m.length > MOTIF_REGLEMENT_MAX) return `Le motif du règlement est trop long (${MOTIF_REGLEMENT_MAX} caractères maximum).`;
  return null;
}

/**
 * Motif à enregistrer lors de la MODIFICATION d'un brouillon. Un brouillon qui a déjà un motif doit en garder un valide ;
 * un brouillon antérieur au lot I (sans motif) n'est jamais bloqué : motif vide accepté (il reste « Non renseigné »),
 * motif fourni validé comme pour un nouveau règlement.
 */
export function motifPourModification(
  motifExistant: string | null | undefined,
  motifSaisi: string | null | undefined
): { ok: true; motif: string | null } | { ok: false; message: string } {
  const saisi = nettoyerMotifReglement(motifSaisi);
  const existant = nettoyerMotifReglement(motifExistant);
  if (saisi.length === 0 && existant.length === 0) return { ok: true, motif: null };
  const refus = refusMotifReglement(saisi);
  return refus ? { ok: false, message: refus } : { ok: true, motif: saisi };
}

/** Libellé d'affichage : le motif, ou « Non renseigné » pour un règlement ancien. */
export function libelleMotifReglement(motif: string | null | undefined): string {
  const m = nettoyerMotifReglement(motif);
  return m.length > 0 ? m : MOTIF_REGLEMENT_NON_RENSEIGNE;
}
