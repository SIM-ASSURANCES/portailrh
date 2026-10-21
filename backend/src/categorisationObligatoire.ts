// Catégorisation obligatoire avant validation (2026-10-08). Une ligne d'article (ou une dépense directe, sans ligne)
// ne peut être VALIDÉE que si elle porte une catégorie ; une ligne REJETÉE n'en a pas besoin. Fonctions pures, sans
// dépendance Prisma : partagées par les Server Actions (refus) et les écrans (bouton grisé avec la même phrase).
//
// Lot I (2026-10-19) : la règle n'est plus permanente. La Finance fixe une « date à partir de laquelle la catégorisation
// est obligatoire » (`ParametreTresorerie`, clé `CLE_CATEGORISATION_OBLIGATOIRE_DES`) ; avant cette date, ou si elle est
// nulle, valider sans catégorie est permis. Toutes les fonctions de refus prennent donc `obligatoire` (résultat de
// `categorisationObligatoireAu`) : AUCUN appelant ne peut oublier la règle, ni la contourner sans passer par ici.

/** Clé du paramètre (`ParametreTresorerie.cle`) : première date (incluse) où la catégorisation devient obligatoire. */
export const CLE_CATEGORISATION_OBLIGATOIRE_DES = "categorisation.obligatoire_a_partir_du";

/** Jour (AAAA-MM-JJ) d'une date ou d'une chaîne ; `null` si absent ou invalide. */
function jourDe(valeur: Date | string | null | undefined): string | null {
  if (!valeur) return null;
  if (typeof valeur === "string") return /^\d{4}-\d{2}-\d{2}/.test(valeur) ? valeur.slice(0, 10) : null;
  return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString().slice(0, 10);
}

/**
 * La catégorisation est-elle obligatoire à `maintenant` ? Date nulle ou invalide : jamais obligatoire ; sinon obligatoire
 * dès le jour fixé (inclus), comparaison au jour près (jamais à l'heure).
 */
export function categorisationObligatoireAu(
  dateDebut: Date | string | null | undefined,
  maintenant: Date
): boolean {
  const debut = jourDe(dateDebut);
  if (!debut) return false;
  return jourDe(maintenant)! >= debut;
}

/** Contrôle de la date saisie par la Finance : vide = jamais obligatoire ; sinon un jour valide AAAA-MM-JJ. */
export function validerDateCategorisation(
  saisie: string | null | undefined
): { ok: true; date: string | null } | { ok: false; message: string } {
  const s = (saisie ?? "").trim();
  if (s === "") return { ok: true, date: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, message: "Date invalide (format attendu : AAAA-MM-JJ)." };
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, message: "Date invalide." };
  return { ok: true, date: s };
}

/** Phrase d'information sur la règle en vigueur (écran de paramétrage et bandeaux). */
export function libelleRegleCategorisation(dateDebut: Date | string | null | undefined, maintenant: Date): string {
  const debut = jourDe(dateDebut);
  if (!debut) return "La catégorisation n'est pas obligatoire pour valider (aucune date fixée).";
  const [a, m, j] = debut.split("-");
  const date = `${j}/${m}/${a}`;
  return categorisationObligatoireAu(debut, maintenant)
    ? `La catégorisation est obligatoire pour valider depuis le ${date}.`
    : `La catégorisation deviendra obligatoire pour valider à partir du ${date} ; jusque-là, on peut valider sans catégorie.`;
}

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
  lignes: readonly LigneCategorisable[],
  obligatoire: boolean
): string | null {
  if (!obligatoire) return null;
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
export function refusDemandeSansCategorie(demande: { categorieId: string | null }, obligatoire: boolean): string | null {
  if (!obligatoire) return null;
  return demande.categorieId ? null : MESSAGE_DEMANDE_SANS_CATEGORIE;
}
