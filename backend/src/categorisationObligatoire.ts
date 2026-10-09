// Catégorisation obligatoire avant validation (2026-10-08). Une ligne d'article (ou une dépense directe, sans ligne)
// ne peut être VALIDÉE que si elle porte une catégorie ; une ligne REJETÉE n'en a pas besoin. Fonctions pures, sans
// dépendance Prisma : partagées par les Server Actions (refus) et les écrans (bouton grisé avec la même phrase).

/** Phrase affichée sous le bouton « Valider » grisé d'une ligne, et renvoyée par le serveur. */
export const MESSAGE_LIGNE_SANS_CATEGORIE =
  "Catégorisez cette ligne avant de la valider (une ligne rejetée n'a pas besoin de catégorie).";

/** Phrase des boutons de validation d'une demande sans ligne (dépense directe). */
export const MESSAGE_DEMANDE_SANS_CATEGORIE = "Catégorisez cette demande avant de la valider.";

type LigneCategorisable = { id: string; libelle: string; categorieId: string | null };
type DecisionLigne = { ligneId: string; statut: "VALIDEE" | "REJETEE" };

/**
 * Refus si au moins une ligne décidée « VALIDEE » n'a pas de catégorie ; `null` sinon. Le message cite les lignes en
 * cause. Les lignes rejetées sont ignorées.
 */
export function refusLignesValideesSansCategorie(
  decisions: readonly DecisionLigne[],
  lignes: readonly LigneCategorisable[]
): string | null {
  const parId = new Map(lignes.map((l) => [l.id, l]));
  const sansCategorie = decisions
    .filter((d) => d.statut === "VALIDEE")
    .map((d) => parId.get(d.ligneId))
    .filter((l): l is LigneCategorisable => !!l && !l.categorieId);
  if (sansCategorie.length === 0) return null;
  const noms = sansCategorie.map((l) => `« ${l.libelle} »`).join(", ");
  return sansCategorie.length === 1
    ? `La ligne ${noms} n'a pas de catégorie : catégorisez-la avant de la valider, ou rejetez-la.`
    : `Les lignes ${noms} n'ont pas de catégorie : catégorisez-les avant de les valider, ou rejetez-les.`;
}

/** Refus de valider (totalement, partiellement ou en complément) une demande sans ligne qui n'a pas de catégorie. */
export function refusDemandeSansCategorie(demande: { categorieId: string | null }): string | null {
  return demande.categorieId ? null : MESSAGE_DEMANDE_SANS_CATEGORIE;
}
