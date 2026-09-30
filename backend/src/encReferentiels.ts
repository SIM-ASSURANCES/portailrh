// Référentiels du module « Encaissements, taxes » (docs/encaissements-conception.md §5.2, CDC V2.6 §3.6) : branches,
// bénéficiaire des honoraires daté, partenaires (partage des accessoires), taux de contrôle. Fonctions PURES
// uniquement (aucun accès à la base) ; l'écriture et le rattachement à `EncAudit` vivent dans les Server Actions
// (`frontend/src/app/(dashboard)/encaissements/parametres/actions.ts`), pas ici.

export class EncReferentielError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncReferentielError";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Branches (P1, provisoire) et partenaires : normalisation des identifiants
// ---------------------------------------------------------------------------------------------------------------

/** Code de branche : majuscules, chiffres, tiret et underscore uniquement (identifiant technique, pas un libellé). */
const CODE_BRANCHE_REGEX = /^[A-Z0-9_-]{2,20}$/;

export function normaliserCodeBranche(code: string): string {
  const c = code.trim().toUpperCase();
  if (!CODE_BRANCHE_REGEX.test(c)) {
    throw new EncReferentielError("Le code de branche doit contenir de 2 à 20 lettres majuscules, chiffres, « - » ou « _ ».");
  }
  return c;
}

/**
 * Normalise un nom de partenaire pour en faire la clé de rapprochement (`EncPartenaire.cleNom`) : majuscules, espaces
 * multiples réduits à un seul, ponctuation de séparation ignorée (même principe que le rapprochement de référence des
 * relevés, CDC §7.2 : « sans tenir compte des majuscules, espaces et signes »). Réutilisée telle quelle par l'import
 * de production (Lot 1) pour retrouver un partenaire déjà créé.
 */
export function normaliserNomPartenaire(nom: string): string {
  const n = nom
    .trim()
    .toUpperCase()
    .replace(/[.,;:'’"()/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!n) throw new EncReferentielError("Le nom du partenaire ne peut pas être vide.");
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
// Bénéficiaire des honoraires (CDC §3.6) : en vigueur à une date
// ---------------------------------------------------------------------------------------------------------------

export interface BeneficiaireHonoraires {
  nom: string;
  dateDebut: Date;
}

/**
 * Ligne « NOVELIA » posée par la migration (jamais par une action utilisateur, `creeParId` nul en base pour cette
 * seule ligne). Date de début choisie PROVISOIREMENT au 2000-01-01 comme repère « depuis toujours » : le cahier
 * décrit NOVELIA comme le bénéficiaire actuel sans donner de date d'origine réelle, et aucun encaissement n'existe
 * encore (Lot 1) pour qu'une date plus tardive change quoi que ce soit en pratique. À confirmer avec le client si une
 * vraie date de début existe et doit remplacer celle-ci.
 */
export const ENC_BENEFICIAIRE_HONORAIRES_INITIAL = { nom: "NOVELIA", dateDebut: "2000-01-01" } as const;

/**
 * Bénéficiaire en vigueur à une date donnée (CDC §3.6 : « les honoraires d'un encaissement reviennent au bénéficiaire
 * en vigueur à sa date de prise en compte ») : celui dont la `dateDebut` est la plus récente sans dépasser `date`.
 * `null` si aucune ligne ne précède `date` (base non initialisée : ne doit jamais arriver une fois la migration
 * appliquée, qui pose toujours NOVELIA — vérifié par test). Comparaison en jour calendaire (une `dateDebut` égale à
 * `date` compte, cohérent avec le reste du module : la date du jour est toujours incluse, jamais exclue).
 */
export function beneficiaireHonorairesEnVigueur(liste: readonly BeneficiaireHonoraires[], date: Date): BeneficiaireHonoraires | null {
  const cible = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let retenu: BeneficiaireHonoraires | null = null;
  let retenuInstant = -Infinity;
  for (const b of liste) {
    const instant = Date.UTC(b.dateDebut.getUTCFullYear(), b.dateDebut.getUTCMonth(), b.dateDebut.getUTCDate());
    if (instant <= cible && instant > retenuInstant) {
      retenu = b;
      retenuInstant = instant;
    }
  }
  return retenu;
}

// ---------------------------------------------------------------------------------------------------------------
// Partage des accessoires : contrôle du taux avant écriture (CDC §5.4)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Contrôle une part partenaire exprimée en POURCENTAGE (0 à 100, telle que saisie à l'écran, F9) et la convertit en
 * fraction (0 à 1) pour le stockage — même unité que `EncParametre` `accessoires.part_partenaire_defaut` et que
 * `encCalcul.choisirTauxAccessoires`/`partagerAccessoires`, qui consomment directement cette fraction sans conversion
 * supplémentaire (« branché sur le moteur »). `null` = pas de taux propre, retombe sur le taux du partenaire ou le
 * défaut selon le niveau.
 */
export function pourcentagePartenaireVersFraction(pctPartenaire: number | null): string | null {
  if (pctPartenaire === null) return null;
  if (!Number.isFinite(pctPartenaire) || pctPartenaire < 0 || pctPartenaire > 100) {
    throw new EncReferentielError("La part partenaire des accessoires doit être un pourcentage entre 0 et 100.");
  }
  // 6 décimales sur la FRACTION (Decimal(7,6)) : 4 décimales sur le pourcentage, largement au-delà de la précision
  // utile d'une saisie à l'écran, jamais de perte silencieuse par arrondi flottant (division en texte, pas en Number).
  return (Math.round(pctPartenaire * 10000) / 1000000).toFixed(6);
}

// ---------------------------------------------------------------------------------------------------------------
// Taux de contrôle (CDC §3.6, F9) : au moins un des deux axes renseigné
// ---------------------------------------------------------------------------------------------------------------

export interface CleTauxControle {
  produitCode: string | null;
  partenaireId: string | null;
}

/** Un taux de contrôle porte toujours sur au moins un produit ou un partenaire : le cahier ne décrit aucun contrôle
 *  « global » valable pour tout, et une ligne (null, null) ne serait protégée par aucune contrainte d'unicité. */
export function verifierCleTauxControle(cle: CleTauxControle): void {
  if (cle.produitCode === null && cle.partenaireId === null) {
    throw new EncReferentielError("Un taux de contrôle doit porter sur un produit, un partenaire, ou les deux.");
  }
}
