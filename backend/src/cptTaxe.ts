import { enCentimesEcheancier, texteDepuisCentimes } from "./cptEcheancier";
import { tauxTcaEnVigueur, type BrancheCpt, type NatureContratCpt, type TauxTcaLigne } from "./cptReferentiels";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module : le calcul de taxe d'Encaissements n'est pas réutilisé).

/**
 * Moteur de la taxe sur les contrats (TCA) — lot GC-8, docs/PLAN_GESTION_COMPTA.md §7.1 et conception §6.1. PUR : aucun accès base,
 * montants en centimes entiers (bigint), dates en texte AAAA-MM-JJ, taux en fraction texte (« 0.0725 »).
 *
 * Quatre faits à retenir :
 *  - la taxe est CONTENUE dans un montant TTC : montant × taux ÷ (1 + taux), arrondie à l'UNITÉ (D4) ;
 *  - un rattachement VALIDÉ est taxé au prorata de la taxe de son échéance, le reliquat exact allant au rattachement qui la solde ;
 *  - un encaissement dont le produit ou le contrat est connu mais qui n'est pas rattaché reçoit une AVANCE de taxe (cas T5) ;
 *    au rattachement, la part d'avance couverte est ANNULÉE par une imputation négative : la taxe déjà payée n'est jamais redemandée ;
 *  - jamais de taux deviné : sans taux (ni sur le contrat, ni au référentiel à la date), AUCUNE taxe n'est calculée.
 */

const ZERO = BigInt(0);
const DEUX = BigInt(2);
const CENT = BigInt(100);
const MILLION = BigInt(1000000);

export type MontantTaxeEntree = string | number;

/** Texte ou nombre → centimes (≥ 0), `null` si invalide. */
export function centimesTaxeCpt(valeur: MontantTaxeEntree | null | undefined): bigint | null {
  return enCentimesEcheancier(valeur);
}

export function montantTaxeEnTexteCpt(centimes: bigint): string {
  return texteDepuisCentimes(centimes);
}

/** Centimes → FCFA entiers (arrondi à l'unité, demi vers le haut, signe conservé). */
export function arrondirUniteCpt(centimes: bigint): bigint {
  const negatif = centimes < ZERO;
  const abs = negatif ? -centimes : centimes;
  const arrondi = ((abs + CENT / DEUX) / CENT) * CENT;
  return negatif ? -arrondi : arrondi;
}

/** « 0.072500 » → 72500 (millionièmes) ; `null` si ce n'est pas une fraction de 0 (inclus) à 1 (exclu). */
export function tauxEnMillioniemesCpt(taux: string | null | undefined): bigint | null {
  const m = /^(0)(?:[.,](\d{1,6}))?$/.exec(String(taux ?? "").trim());
  if (!m) return null;
  return BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

/**
 * Taxe contenue dans un montant TTC : montant × taux ÷ (1 + taux), arrondie à l'unité. Cinq taux du plan sur 2 500 FCFA :
 * 7,25 % → 169 ; 1,5 % → 37 ; 4 % → 96 ; 12,5 % → 278 ; 0 % → 0. `null` si le taux est invalide.
 */
export function taxeContenueCpt(montantCentimes: bigint, taux: string): bigint | null {
  const t = tauxEnMillioniemesCpt(taux);
  if (t === null) return null;
  if (montantCentimes === ZERO || t === ZERO) return ZERO;
  const negatif = montantCentimes < ZERO;
  const abs = negatif ? -montantCentimes : montantCentimes;
  const numerateur = abs * t;
  const denominateur = MILLION + t;
  const unite = arrondirUniteDepuisFraction(numerateur, denominateur);
  return negatif ? -unite : unite;
}

/** arrondi à l'unité (100 centimes) de numerateur ÷ denominateur, demi vers le haut, SANS passer par un arrondi au centime. */
function arrondirUniteDepuisFraction(numerateur: bigint, denominateur: bigint): bigint {
  const unites = (numerateur * DEUX + denominateur * CENT) / (denominateur * CENT * DEUX);
  return unites * CENT;
}

// ---------------------------------------------------------------------------------------------------------------------
// Taux applicable
// ---------------------------------------------------------------------------------------------------------------------

export interface CritereTauxContratCpt {
  branche: BrancheCpt;
  produitCode: string | null;
  natureContrat: NatureContratCpt | null;
  /** Date de valeur de l'encaissement (C-10), AAAA-MM-JJ. */
  date: string;
  /** Taux saisi sur le contrat (SECURPRO, Q7) : il l'emporte sur le référentiel. */
  tauxContrat?: string | null;
}

export type SourceTauxCpt = "CONTRAT" | "REFERENTIEL";

/**
 * Taux de TCA applicable (C-10, C-15) : le taux saisi sur le contrat, sinon celui du référentiel en vigueur à la date de valeur.
 * `null` si aucun : le moteur ne devine JAMAIS zéro.
 */
export function tauxApplicableCpt(lignes: readonly TauxTcaLigne[], critere: CritereTauxContratCpt): { taux: string; source: SourceTauxCpt } | null {
  if (critere.tauxContrat && tauxEnMillioniemesCpt(critere.tauxContrat) !== null) return { taux: critere.tauxContrat, source: "CONTRAT" };
  const ligne = tauxTcaEnVigueur(lignes, { branche: critere.branche, produitCode: critere.produitCode, natureContrat: critere.natureContrat, date: critere.date });
  return ligne ? { taux: ligne.taux, source: "REFERENTIEL" } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Les cinq cas
// ---------------------------------------------------------------------------------------------------------------------

export type CasTaxeCpt = "RATTACHE" | "SANS_CONTRAT" | "CONTRAT_NON_RATTACHE" | "NON_IDENTIFIE" | "PAS_UNE_PRIME";

export const LIBELLE_CAS_TAXE_CPT: Record<CasTaxeCpt, string> = {
  RATTACHE: "Rattaché à une échéance : taxe du contrat au prorata",
  SANS_CONTRAT: "Sans contrat, produit connu : taxe contenue dans le montant",
  CONTRAT_NON_RATTACHE: "Contrat connu, pas encore rattaché : taxe contenue, imputée au rattachement",
  NON_IDENTIFIE: "Non identifié : aucune taxe",
  PAS_UNE_PRIME: "Pas une prime : aucune taxe",
};

/** Cas d'une part d'encaissement. L'ordre compte : « pas une prime » et « rattaché » avant les cas de repli. */
export function casTaxeCpt(e: { pasUnePrime: boolean; rattache: boolean; contratConnu: boolean; produitConnu: boolean }): CasTaxeCpt {
  if (e.pasUnePrime) return "PAS_UNE_PRIME";
  if (e.rattache) return "RATTACHE";
  if (e.contratConnu) return "CONTRAT_NON_RATTACHE";
  if (e.produitConnu) return "SANS_CONTRAT";
  return "NON_IDENTIFIE";
}

/** Part de l'encaissement qui peut être taxée en avance : le montant moins la part « pas une prime » (T1). */
export function baseAvanceCpt(montantCentimes: bigint, pasUnePrimeCentimes: bigint): bigint {
  const base = montantCentimes - pasUnePrimeCentimes;
  return base > ZERO ? base : ZERO;
}

export interface MontantsLigneTaxeCpt {
  /** TTC taxé, signé. */
  base: bigint;
  primeHt: bigint;
  accessoiresHt: bigint;
  taxe: bigint;
}

export type ResultatAvanceCpt =
  | { ok: true; ligne: MontantsLigneTaxeCpt; taux: string }
  | { ok: false; motif: "TAUX_MANQUANT" | "BASE_NULLE" };

/** Avance de taxe sur un encaissement sans contrat ou non encore rattaché (cas 2 et 3). Sans taux : aucune ligne. */
export function calculerAvanceCpt(baseCentimes: bigint, taux: string | null): ResultatAvanceCpt {
  if (baseCentimes <= ZERO) return { ok: false, motif: "BASE_NULLE" };
  if (taux === null || tauxEnMillioniemesCpt(taux) === null) return { ok: false, motif: "TAUX_MANQUANT" };
  const taxe = taxeContenueCpt(baseCentimes, taux) ?? ZERO;
  return { ok: true, taux, ligne: { base: baseCentimes, taxe, accessoiresHt: ZERO, primeHt: baseCentimes - taxe } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Prorata d'un rattachement validé
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Part de `total` (taxe ou accessoires d'une échéance) due par un rattachement de `montant` sur une échéance de `montantDu`.
 * `dejaAttribue` : ce que les rattachements précédents de l'échéance ont déjà reçu. Si ce rattachement SOLDE l'échéance
 * (`solde`), il reçoit le reliquat EXACT (D4) ; sinon la part est arrondie à l'unité.
 */
export function partProrataCpt(p: { total: bigint; montant: bigint; montantDu: bigint; dejaAttribue: bigint; solde: boolean }): bigint {
  if (p.montantDu <= ZERO) return ZERO;
  if (p.solde) {
    const reliquat = p.total - p.dejaAttribue;
    return reliquat > ZERO ? reliquat : ZERO;
  }
  const exact = arrondirUniteDepuisFraction(p.total * p.montant, p.montantDu);
  const reste = p.total - p.dejaAttribue;
  return exact > reste ? (reste > ZERO ? reste : ZERO) : exact;
}

export interface EcheanceTaxeCpt {
  montantDu: bigint;
  taxe: bigint;
  accessoires: bigint;
}

export interface RattachementTaxeCpt {
  montant: bigint;
  /** Σ des rattachements VALIDÉS de l'échéance avant celui-ci. */
  dejaValideSurEcheance: bigint;
  /** Σ de taxe et d'accessoires déjà portés par les lignes RATTACHEMENT de l'échéance. */
  taxeDejaAttribuee: bigint;
  accessoiresDejaAttribues: bigint;
}

/** Montants de la ligne RATTACHEMENT : la taxe du contrat au prorata, sur la base du montant rattaché. */
export function montantsRattachementCpt(e: EcheanceTaxeCpt, r: RattachementTaxeCpt): MontantsLigneTaxeCpt {
  const solde = r.dejaValideSurEcheance + r.montant >= e.montantDu;
  const taxe = partProrataCpt({ total: e.taxe, montant: r.montant, montantDu: e.montantDu, dejaAttribue: r.taxeDejaAttribuee, solde });
  const accessoires = partProrataCpt({ total: e.accessoires, montant: r.montant, montantDu: e.montantDu, dejaAttribue: r.accessoiresDejaAttribues, solde });
  const primeHt = r.montant - taxe - accessoires;
  return { base: r.montant, taxe, accessoiresHt: accessoires, primeHt: primeHt > ZERO ? primeHt : ZERO };
}

// ---------------------------------------------------------------------------------------------------------------------
// Imputation d'une avance
// ---------------------------------------------------------------------------------------------------------------------

export interface AvanceTaxeCpt {
  base: bigint;
  taxe: bigint;
  primeHt: bigint;
  /** Ce que les imputations précédentes ont déjà annulé (valeurs POSITIVES). */
  baseDejaImputee: bigint;
  taxeDejaImputee: bigint;
  primeHtDejaImputee: bigint;
}

/** Part d'avance couverte par un rattachement de `montant` (montants NÉGATIFS, prêts à écrire en ligne IMPUTATION). `null` : rien à imputer. */
export function montantsImputationCpt(a: AvanceTaxeCpt, montant: bigint): MontantsLigneTaxeCpt | null {
  const baseRestante = a.base - a.baseDejaImputee;
  if (baseRestante <= ZERO || montant <= ZERO) return null;
  const portion = montant < baseRestante ? montant : baseRestante;
  const solde = portion === baseRestante;
  const taxe = solde ? a.taxe - a.taxeDejaImputee : arrondirUniteDepuisFraction(a.taxe * portion, a.base);
  const primeHt = solde ? a.primeHt - a.primeHtDejaImputee : arrondirUniteDepuisFraction(a.primeHt * portion, a.base);
  return { base: -portion, taxe: -taxe, primeHt: -primeHt, accessoiresHt: ZERO };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mois de déclaration
// ---------------------------------------------------------------------------------------------------------------------

export function premierDuMoisCpt(dateIso: string): string {
  return `${dateIso.slice(0, 7)}-01`;
}

export function moisSuivantCpt(mois: string): string {
  const annee = Number(mois.slice(0, 4));
  const m = Number(mois.slice(5, 7));
  return m === 12 ? `${annee + 1}-01-01` : `${String(annee).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Mois d'une ligne de taxe (C-3) : le mois de la date de valeur de l'encaissement ; si ce mois est déjà couvert par une déclaration
 * (ou antérieur au dernier mois déclaré), la ligne va au premier mois non encore déclaré — une ligne déclarée ne se réécrit jamais.
 */
export function moisImputationLigneCpt(dateValeur: string, dernierMoisDeclare: string | null): string {
  const moisValeur = premierDuMoisCpt(dateValeur);
  if (!dernierMoisDeclare) return moisValeur;
  const minimum = moisSuivantCpt(dernierMoisDeclare);
  return moisValeur >= minimum ? moisValeur : minimum;
}

// ---------------------------------------------------------------------------------------------------------------------
// Plan de taxe d'un rattachement validé
// ---------------------------------------------------------------------------------------------------------------------

export type OrigineLigneTaxeCpt = "AVANCE" | "RATTACHEMENT" | "IMPUTATION";

export interface LignePlanifieeCpt extends MontantsLigneTaxeCpt {
  origine: "RATTACHEMENT" | "IMPUTATION";
  taux: string;
  /** Pour une imputation : l'avance dont une part est annulée. */
  ligneAvanceId?: string;
}

export interface EntreePlanRattachementCpt {
  echeance: EcheanceTaxeCpt;
  rattachement: RattachementTaxeCpt;
  taux: string | null;
  /** Avance existante de l'encaissement, avec ce qui en a déjà été imputé. */
  avance?: (AvanceTaxeCpt & { id: string; taux: string }) | null;
}

export type PlanRattachementCpt = { ok: true; lignes: LignePlanifieeCpt[] } | { ok: false; motif: "TAUX_MANQUANT" };

/**
 * Lignes à écrire quand un rattachement est VALIDÉ : la ligne RATTACHEMENT (taxe du contrat au prorata) et, s'il existe une avance
 * sur l'encaissement, la ligne IMPUTATION négative qui annule la part d'avance couverte (taux de l'avance). Net : l'écart entre la
 * taxe payée d'avance et la taxe du contrat — jamais la taxe redemandée en entier (T5). Sans taux : aucune ligne.
 */
export function planifierTaxeRattachementCpt(e: EntreePlanRattachementCpt): PlanRattachementCpt {
  if (e.taux === null || tauxEnMillioniemesCpt(e.taux) === null) return { ok: false, motif: "TAUX_MANQUANT" };
  const lignes: LignePlanifieeCpt[] = [{ origine: "RATTACHEMENT", taux: e.taux, ...montantsRattachementCpt(e.echeance, e.rattachement) }];
  if (e.avance) {
    const imputation = montantsImputationCpt(e.avance, e.rattachement.montant);
    if (imputation) lignes.push({ origine: "IMPUTATION", taux: e.avance.taux, ligneAvanceId: e.avance.id, ...imputation });
  }
  return { ok: true, lignes };
}

// ---------------------------------------------------------------------------------------------------------------------
// Calcul du mois et crédits (GC-8c)
// ---------------------------------------------------------------------------------------------------------------------

export interface DeclarationAnterieureCpt {
  mois: string;
  montantAPayer: bigint;
  /** Montant de la quittance si la déclaration est payée. */
  quittanceMontant: bigint | null;
}

/** Ce qu'une déclaration antérieure a ENGAGÉ : la quittance si elle est payée (un trop-payé compte), sinon le montant à payer. */
export function montantEngageCpt(d: DeclarationAnterieureCpt): bigint {
  return d.quittanceMontant ?? d.montantAPayer;
}

export interface EntreeCalculMoisCpt {
  mois: string;
  /** Σ des lignes de taxe des mois ≤ `mois`, corrections comprises (signées). */
  montantDuCumule: bigint;
  /** Part de ce cumul qui vient des imputations (corrections de taxe déjà payée d'avance), pour information. */
  corrections: bigint;
  nbLignesDuMois: number;
  anterieures: readonly DeclarationAnterieureCpt[];
  creditsOuverts: readonly { id: string; montant: bigint }[];
}

export interface CalculMoisTcaCpt {
  mois: string;
  /** Taxe due cumulée jusqu'à ce mois. */
  montantDu: bigint;
  corrections: bigint;
  /** Taxe déjà engagée par les déclarations antérieures (quittances comprises). */
  montantDejaPaye: bigint;
  /** `montantDu − montantDejaPaye`, négatif = trop-payé. */
  brut: bigint;
  montantAPayer: bigint;
  /** Crédit à reporter sur le mois suivant (trop-payé), 0 si rien à reporter. */
  credit: bigint;
  /** Crédits antérieurs absorbés par ce mois (ils sont récupérés ; un nouveau crédit porte le solde éventuel). */
  creditsRecuperes: string[];
  creditOuvertAvant: bigint;
  nbLignesDuMois: number;
}

/**
 * Calcul du mois : à payer = taxe due cumulée − taxe déjà payée (quittances), jamais négatif. Le cumul fait lui-même le REPORT : un
 * trop-payé d'un mois diminue naturellement ce qui reste à payer le mois suivant. Les crédits enregistrés ne sont donc JAMAIS soustraits
 * une seconde fois ; ils ne servent qu'à tracer le trop-payé (créé ici si le brut est négatif, récupéré au calcul suivant).
 */
export function calculerMoisTcaCpt(e: EntreeCalculMoisCpt): CalculMoisTcaCpt {
  const dejaPaye = e.anterieures.filter((d) => d.mois < e.mois).reduce((s, d) => s + montantEngageCpt(d), ZERO);
  const brut = e.montantDuCumule - dejaPaye;
  return {
    mois: e.mois,
    montantDu: e.montantDuCumule,
    corrections: e.corrections,
    montantDejaPaye: dejaPaye,
    brut,
    montantAPayer: brut > ZERO ? brut : ZERO,
    credit: brut < ZERO ? -brut : ZERO,
    creditsRecuperes: e.creditsOuverts.map((c) => c.id),
    creditOuvertAvant: e.creditsOuverts.reduce((s, c) => s + c.montant, ZERO),
    nbLignesDuMois: e.nbLignesDuMois,
  };
}

/** Trop-payé constaté au paiement : quittance supérieure au montant déclaré. */
export function tropPayeAuPaiementCpt(montantAPayer: bigint, quittanceMontant: bigint): bigint {
  return quittanceMontant > montantAPayer ? quittanceMontant - montantAPayer : ZERO;
}

export interface EntreeDeclarabiliteCpt {
  mois: string;
  /** Mois courant (AAAA-MM-01). */
  moisCourant: string;
  dernierMoisDeclare: string | null;
  /** Mois (AAAA-MM-01) qui portent encore des lignes non déclarées. */
  moisAvecLignesNonDeclarees: readonly string[];
  /** Rattachements validés sans taux applicable (leur taxe manquerait à la déclaration). */
  nbTauxManquants: number;
}

export const MESSAGE_MOIS_NON_TERMINE_CPT = "Ce mois n'est pas terminé : la taxe d'un mois se déclare le mois suivant.";
export const MESSAGE_MOIS_DEJA_DECLARE_CPT = "Ce mois (ou un mois suivant) est déjà déclaré.";

/** Motif de refus de la déclaration d'un mois, ou `null` si elle est possible. Les mois se déclarent dans l'ordre. */
export function refusDeclarationMoisCpt(e: EntreeDeclarabiliteCpt): string | null {
  if (!/^\d{4}-\d{2}-01$/.test(e.mois)) return "Mois invalide.";
  if (e.mois >= e.moisCourant) return MESSAGE_MOIS_NON_TERMINE_CPT;
  if (e.dernierMoisDeclare && e.mois <= e.dernierMoisDeclare) return MESSAGE_MOIS_DEJA_DECLARE_CPT;
  const avant = [...e.moisAvecLignesNonDeclarees].filter((m) => m < e.mois).sort();
  if (avant.length > 0) return `Déclarez d'abord le mois du ${avant[0].slice(0, 7)} : il porte encore des lignes de taxe non déclarées.`;
  if (e.nbTauxManquants > 0) {
    return `${e.nbTauxManquants} rattachement(s) validé(s) n'ont pas de taux de TCA : saisissez le taux puis recalculez avant de déclarer.`;
  }
  return null;
}

/** Date limite de déclaration et de paiement du mois : le `jourLimite` du mois suivant (paramètre, 1 à 28). */
export function dateLimiteTcaCpt(mois: string, jourLimite: number): string {
  const suivant = moisSuivantCpt(mois);
  return `${suivant.slice(0, 8)}${String(jourLimite).padStart(2, "0")}`;
}

/** Numéro de la déclaration : l'année du mois déclaré porte la séquence `CPD-AAAA`. */
export function anneeDeclarationCpt(mois: string): number {
  return Number(mois.slice(0, 4));
}
