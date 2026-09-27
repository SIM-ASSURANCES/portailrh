import DecimalJs from "decimal.js";

/**
 * Moteur de calcul PUR du module Encaissements (voir docs/encaissements-conception.md et le cahier des charges,
 * §5 « Règles de calcul »). Aucun accès à la base, aucune date système implicite, aucun paramètre en dur :
 * le délai d'exigibilité et le jour limite de reversement sont des arguments (ils viendront d'EncParametre).
 *
 * Décimal : clone LOCAL de decimal.js (arrondi half-up), jamais `Decimal.set` global qui modifierait la
 * configuration partagée. Aucun `Number()` sur un montant : les entrées sont des chaînes ou des objets
 * « Decimal.js-like » (dont `Prisma.Decimal`), convertis par `toFixed()` (exact, sans notation exponentielle).
 * Les sorties sont des instances decimal.js, acceptées telles quelles par Prisma en écriture.
 *
 * Dates : jours calendaires lus en UTC (un champ Prisma `@db.Date` arrive à minuit UTC). Fonctions de date
 * construites avec `jourCalendaire(a, m, j)`.
 */

export const EncDecimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});
export type Montant = InstanceType<typeof EncDecimal>;

/** Même contrat que `DecimalJsLike` de Prisma : un `number` n'y satisfait pas (refusé à la compilation). */
export interface DecimalLike {
  d: number[];
  e: number;
  s: number;
  toFixed(): string;
}
export type MontantEntree = string | DecimalLike;

export class EncCalculError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "EncCalculError";
  }
}

export function montant(valeur: MontantEntree): Montant {
  if (typeof valeur === "string") return new EncDecimal(valeur);
  if (valeur === null || typeof valeur !== "object" || typeof valeur.toFixed !== "function") {
    throw new EncCalculError("MONTANT_INVALIDE", "Montant invalide : chaîne ou objet décimal attendu (jamais un nombre flottant).");
  }
  return new EncDecimal(valeur.toFixed());
}

const ZERO = new EncDecimal(0);

/** Arrondi au centime, half-up (0,005 → 0,01 ; −0,005 → −0,01, arrondi « à l'écart de zéro » de decimal.js). */
export function arrondirCentime(valeur: MontantEntree | Montant): Montant {
  const d = valeur instanceof EncDecimal ? valeur : montant(valeur as MontantEntree);
  return d.toDecimalPlaces(2, EncDecimal.ROUND_HALF_UP);
}

function somme(valeurs: Montant[]): Montant {
  return valeurs.reduce((acc, v) => acc.plus(v), ZERO);
}

// ---------------------------------------------------------------------------------------------------------------
// Dates (jours calendaires UTC)
// ---------------------------------------------------------------------------------------------------------------

const MS_PAR_JOUR = 86_400_000;

export function jourCalendaire(annee: number, mois: number, jour: number): Date {
  return new Date(Date.UTC(annee, mois - 1, jour));
}

function joursDansMois(annee: number, mois0: number): number {
  return new Date(Date.UTC(annee, mois0 + 1, 0)).getUTCDate();
}

function premierDuMois(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Ajoute `n` mois en gardant le jour d'origine, ramené au dernier jour du mois s'il n'existe pas (31/01 + 1 → 28/02). */
function ajouterMois(date: Date, n: number, jourAncre = date.getUTCDate()): Date {
  const total = date.getUTCMonth() + n;
  const annee = date.getUTCFullYear() + Math.floor(total / 12);
  const mois0 = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(annee, mois0, Math.min(jourAncre, joursDansMois(annee, mois0))));
}

function ecartJours(debut: Date, fin: Date): number {
  return Math.round((premierInstant(fin) - premierInstant(debut)) / MS_PAR_JOUR);
}

function premierInstant(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// ---------------------------------------------------------------------------------------------------------------
// Décomposition de la prime (§5.1, §3.7 saisie directe)
// ---------------------------------------------------------------------------------------------------------------

export type BaseTaux = "PRIME_NETTE" | "PRIME_NETTE_ACCESSOIRES" | "PRIME_TTC";

export interface TauxContrat {
  /** Fractions décimales (0.0725 pour 7,25 %). */
  tauxTaxe: MontantEntree;
  tauxCommission: MontantEntree;
  tauxGestion: MontantEntree;
  /** Soit un taux, soit un montant fixe ; zéro si aucun des deux. */
  tauxAccessoires?: MontantEntree;
  montantFixeAccessoires?: MontantEntree;
  baseAccessoires?: BaseTaux;
  baseTaxe?: BaseTaux;
  baseCommission?: BaseTaux;
  baseGestion?: BaseTaux;
}

/** Montants d'un contrat : S prime TTC, T prime nette, U accessoires, V taxes, W commission, X honoraires. */
export interface MontantsContrat {
  S: Montant;
  T: Montant;
  U: Montant;
  V: Montant;
  W: Montant;
  X: Montant;
}

function baseDe(base: BaseTaux, T: Montant, U: Montant, S: Montant | null, quoi: string): Montant {
  if (base === "PRIME_NETTE") return T;
  if (base === "PRIME_NETTE_ACCESSOIRES") return T.plus(U);
  if (S === null) {
    throw new EncCalculError(
      "BASE_CIRCULAIRE",
      `Base « prime TTC » impossible pour ${quoi} : la prime TTC dépend de ce montant (calcul circulaire, ambiguïté 7).`
    );
  }
  return S;
}

/** Saisie directe depuis la prime nette (§3.7) : U, V, S, puis W et X, chacun arrondi au centime. */
export function decomposerDepuisPrimeNette(primeNette: MontantEntree, taux: TauxContrat): MontantsContrat {
  const T = arrondirCentime(primeNette);
  if (T.lte(0)) throw new EncCalculError("PRIME_INVALIDE", "La prime nette doit être supérieure à 0.");
  if (taux.tauxAccessoires !== undefined && taux.montantFixeAccessoires !== undefined) {
    throw new EncCalculError("ACCESSOIRES_AMBIGUS", "Accessoires : renseigner un taux OU un montant fixe, pas les deux.");
  }
  const U =
    taux.montantFixeAccessoires !== undefined
      ? arrondirCentime(taux.montantFixeAccessoires)
      : taux.tauxAccessoires !== undefined
        ? arrondirCentime(baseDe(taux.baseAccessoires ?? "PRIME_NETTE", T, ZERO, null, "les accessoires").times(montant(taux.tauxAccessoires)))
        : ZERO;
  const V = arrondirCentime(baseDe(taux.baseTaxe ?? "PRIME_NETTE_ACCESSOIRES", T, U, null, "la taxe").times(montant(taux.tauxTaxe)));
  const S = T.plus(U).plus(V);
  const W = arrondirCentime(baseDe(taux.baseCommission ?? "PRIME_NETTE", T, U, S, "la commission").times(montant(taux.tauxCommission)));
  const X = arrondirCentime(baseDe(taux.baseGestion ?? "PRIME_NETTE", T, U, S, "les honoraires").times(montant(taux.tauxGestion)));
  return { S, T, U, V, W, X };
}

/**
 * Calcul inverse depuis la prime TTC (§5.1) : T = S ÷ [(1 + taux accessoires) × (1 + taux taxe)].
 * Défini uniquement pour les bases par défaut et des accessoires en taux : refusé explicitement sinon.
 * V = S − T − U, pour que la prime TTC saisie reste exacte au centime.
 */
export function decomposerDepuisPrimeTtc(primeTtc: MontantEntree, taux: TauxContrat): MontantsContrat {
  const S = arrondirCentime(primeTtc);
  if (S.lte(0)) throw new EncCalculError("PRIME_INVALIDE", "La prime TTC doit être supérieure à 0.");
  if (taux.montantFixeAccessoires !== undefined) {
    throw new EncCalculError(
      "CALCUL_INVERSE_IMPOSSIBLE",
      "Calcul inverse impossible avec des accessoires en montant fixe : saisir la prime nette."
    );
  }
  const basesNonDefaut = [
    ["accessoires", taux.baseAccessoires, "PRIME_NETTE"],
    ["taxe", taux.baseTaxe, "PRIME_NETTE_ACCESSOIRES"],
    ["commission", taux.baseCommission, "PRIME_NETTE"],
    ["gestion", taux.baseGestion, "PRIME_NETTE"],
  ].filter(([, base, defaut]) => base !== undefined && base !== defaut);
  if (basesNonDefaut.length > 0) {
    throw new EncCalculError(
      "CALCUL_INVERSE_IMPOSSIBLE",
      `Calcul inverse défini seulement pour les bases par défaut ; base modifiée pour : ${basesNonDefaut.map(([n]) => n).join(", ")}.`
    );
  }
  const ta = taux.tauxAccessoires !== undefined ? montant(taux.tauxAccessoires) : ZERO;
  const tt = montant(taux.tauxTaxe);
  const T = arrondirCentime(S.dividedBy(ta.plus(1).times(tt.plus(1))));
  const U = arrondirCentime(T.times(ta));
  const V = S.minus(T).minus(U);
  const W = arrondirCentime(T.times(montant(taux.tauxCommission)));
  const X = arrondirCentime(T.times(montant(taux.tauxGestion)));
  return { S, T, U, V, W, X };
}

// ---------------------------------------------------------------------------------------------------------------
// Prorata d'un versement (§5.2) — règle d'arrondi PROVISOIRE isolée (ambiguïté 18)
// ---------------------------------------------------------------------------------------------------------------

/** Cumul des versements VALIDÉS précédents du contrat (contre-passations incluses, avec leur signe). */
export interface CumulVersements {
  Z: Montant;
  AB: Montant;
  AC: Montant;
  AD: Montant;
  commission: Montant;
  honoraires: Montant;
}

export interface VentilationVersement {
  AB: Montant; // prime nette reçue
  AC: Montant; // accessoires reçus
  AD: Montant; // taxe
  commission: Montant;
  honoraires: Montant;
}

export interface VersementCalcule extends VentilationVersement {
  Z: Montant;
  AA: Montant; // restant dû après ce versement
  estSoldant: boolean;
}

export type RegleVentilation = (contrat: MontantsContrat, cumul: CumulVersements, Z: Montant, estSoldant: boolean) => VentilationVersement;

/**
 * RÈGLE D'ARRONDI PROVISOIRE (conception §8, arbitrage A7 du 2026-09-26). Seul endroit à modifier si le client
 * tranche autrement l'ambiguïté 18 (contrat incohérent, T + U + V ≠ S).
 * - Non soldant : AB et AC arrondis half-up, AD = Z − AB − AC, commission et honoraires arrondis indépendamment.
 * - Soldant : reliquat exact de chaque composante (total du contrat − cumul). Si T + U + V ≠ S, AB + AC + AD ≠ Z
 *   sur ce versement (ΣAD = V privilégié) : comportement provisoire, en attente du client.
 */
export const regleArrondiProvisoire: RegleVentilation = (contrat, cumul, Z, estSoldant) => {
  if (estSoldant) {
    return {
      AB: contrat.T.minus(cumul.AB),
      AC: contrat.U.minus(cumul.AC),
      AD: contrat.V.minus(cumul.AD),
      commission: contrat.W.minus(cumul.commission),
      honoraires: contrat.X.minus(cumul.honoraires),
    };
  }
  const fraction = (composante: Montant) => arrondirCentime(composante.times(Z).dividedBy(contrat.S));
  const AB = fraction(contrat.T);
  const AC = fraction(contrat.U);
  return { AB, AC, AD: Z.minus(AB).minus(AC), commission: fraction(contrat.W), honoraires: fraction(contrat.X) };
};

export function cumulVide(): CumulVersements {
  return { Z: ZERO, AB: ZERO, AC: ZERO, AD: ZERO, commission: ZERO, honoraires: ZERO };
}

export function ajouterAuCumul(cumul: CumulVersements, v: VersementCalcule): CumulVersements {
  return {
    Z: cumul.Z.plus(v.Z),
    AB: cumul.AB.plus(v.AB),
    AC: cumul.AC.plus(v.AC),
    AD: cumul.AD.plus(v.AD),
    commission: cumul.commission.plus(v.commission),
    honoraires: cumul.honoraires.plus(v.honoraires),
  };
}

/** Calcule un nouveau versement positif. Le trop-perçu (§5.3) est refusé ici : sa validation est un circuit à part (ambiguïté 16). */
export function calculerVersement(
  contrat: MontantsContrat,
  cumul: CumulVersements,
  montantRecu: MontantEntree,
  regle: RegleVentilation = regleArrondiProvisoire
): VersementCalcule {
  const Z = arrondirCentime(montantRecu);
  if (Z.lte(0)) throw new EncCalculError("MONTANT_INVALIDE", "Le montant reçu doit être supérieur à 0.");
  const restantAvant = contrat.S.minus(cumul.Z);
  if (Z.gt(restantAvant)) {
    throw new EncCalculError(
      "TROP_PERCU",
      `Le versement (${Z.toFixed(2)}) dépasse le restant dû (${restantAvant.toFixed(2)}) : trop-perçu, validation du responsable requise.`
    );
  }
  const estSoldant = Z.eq(restantAvant);
  return { Z, AA: restantAvant.minus(Z), estSoldant, ...regle(contrat, cumul, Z, estSoldant) };
}

/** Contre-passation (F3.9) : copie négative EXACTE des valeurs figées, jamais recalculée. */
export function contrepasser(original: VersementCalcule, restantDuActuel: MontantEntree | Montant): VersementCalcule {
  const restant = restantDuActuel instanceof EncDecimal ? restantDuActuel : montant(restantDuActuel as MontantEntree);
  return {
    Z: original.Z.negated(),
    AB: original.AB.negated(),
    AC: original.AC.negated(),
    AD: original.AD.negated(),
    commission: original.commission.negated(),
    honoraires: original.honoraires.negated(),
    AA: restant.plus(original.Z),
    estSoldant: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Exigibilité de la taxe (§5.4, F10.6) et semaine ISO (§7, colonne AG)
// ---------------------------------------------------------------------------------------------------------------

export interface ParametresExigibilite {
  /** Délai d'exigibilité en mois (1 dans le cahier : taxe du mois N exigible en N+1). */
  delaiMois: number;
  /** Jour limite de reversement dans le mois d'exigibilité (20 dans le cahier). */
  jourLimite: number;
}

export interface Exigibilite {
  moisEncaissement: Date;
  moisExigibilite: Date;
  dateLimite: Date;
}

function verifierJourLimite(jourLimite: number) {
  if (!Number.isInteger(jourLimite) || jourLimite < 1 || jourLimite > 31) {
    throw new EncCalculError("PARAMETRE_INVALIDE", "Le jour limite de reversement doit être un entier entre 1 et 31.");
  }
}

function dateLimiteDuMois(mois: Date, jourLimite: number): Date {
  const a = mois.getUTCFullYear();
  const m0 = mois.getUTCMonth();
  return new Date(Date.UTC(a, m0, Math.min(jourLimite, joursDansMois(a, m0))));
}

/** Versement identifié dès sa réception : taxe du mois N exigible en N + délai, à reverser avant le jour limite. */
export function calculerExigibilite(datePaiement: Date, params: ParametresExigibilite): Exigibilite {
  if (!Number.isInteger(params.delaiMois) || params.delaiMois < 0) {
    throw new EncCalculError("PARAMETRE_INVALIDE", "Le délai d'exigibilité doit être un entier positif ou nul.");
  }
  verifierJourLimite(params.jourLimite);
  const moisEncaissement = premierDuMois(datePaiement);
  const moisExigibilite = ajouterMois(moisEncaissement, params.delaiMois);
  return { moisEncaissement, moisExigibilite, dateLimite: dateLimiteDuMois(moisExigibilite, params.jourLimite) };
}

/**
 * Suspens identifié tardivement (F10.6) : la taxe va sur la première déclaration dont l'échéance SUIT la date
 * d'identification (identifié le 10/11 → avant le 20/11 ; le 25/11 → avant le 20/12). Pas de règle N+1.
 * Identifié PILE le jour limite : choix PROVISOIRE « déclaration suivante » (l'échéance du jour même ne « suit » pas
 * l'identification) — ambiguïté 22, OUVERTE.
 */
export function calculerExigibiliteSuspens(dateIdentification: Date, params: Pick<ParametresExigibilite, "jourLimite">): Exigibilite {
  verifierJourLimite(params.jourLimite);
  const moisIdentification = premierDuMois(dateIdentification);
  const limiteDuMois = dateLimiteDuMois(moisIdentification, params.jourLimite);
  const moisExigibilite = premierInstant(dateIdentification) < premierInstant(limiteDuMois) ? moisIdentification : ajouterMois(moisIdentification, 1);
  return { moisEncaissement: moisIdentification, moisExigibilite, dateLimite: dateLimiteDuMois(moisExigibilite, params.jourLimite) };
}

/** Semaine ISO 8601 au format de la colonne AG : « Sem 53 - 2026 » (année ISO, pas année civile). */
export function semaineIso(date: Date): { semaine: number; annee: number; libelle: string } {
  const jour = new Date(premierInstant(date));
  const rangJour = (jour.getUTCDay() + 6) % 7; // lundi = 0
  const jeudi = new Date(jour.getTime() + (3 - rangJour) * MS_PAR_JOUR);
  const annee = jeudi.getUTCFullYear();
  const premierJeudi = new Date(Date.UTC(annee, 0, 4));
  const rangPremier = (premierJeudi.getUTCDay() + 6) % 7;
  const debutSemaine1 = premierJeudi.getTime() - rangPremier * MS_PAR_JOUR;
  const semaine = 1 + Math.floor((jeudi.getTime() - debutSemaine1) / (7 * MS_PAR_JOUR));
  return { semaine, annee, libelle: `Sem ${semaine} - ${annee}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Statuts, DDF, annulation (§5.3, §5.6, §5.7), dus / payés (§5.5)
// ---------------------------------------------------------------------------------------------------------------

/** DDF (colonne N) = échéance − date d'effet, en jours. */
export function calculerDdf(dateEffet: Date, dateEcheance: Date): number {
  const ddf = ecartJours(dateEffet, dateEcheance);
  if (ddf < 0) throw new EncCalculError("DATES_INVALIDES", "La date d'échéance doit être postérieure ou égale à la date d'effet.");
  return ddf;
}

export type StatutContrat = "ANNULE" | "A_VENIR" | "EN_COURS" | "EXPIRE";

export function statutContrat(dateJour: Date, dateEffet: Date, dateEcheance: Date, annule: boolean): StatutContrat {
  if (annule) return "ANNULE";
  if (premierInstant(dateJour) < premierInstant(dateEffet)) return "A_VENIR";
  if (premierInstant(dateJour) <= premierInstant(dateEcheance)) return "EN_COURS";
  return "EXPIRE";
}

export type StatutPaiement = "NON_PAYE" | "PARTIELLEMENT_PAYE" | "TOTALEMENT_PAYE" | "TROP_PERCU" | "ANNULE";

export function statutPaiement(totalEncaisse: MontantEntree | Montant, primeTtc: MontantEntree | Montant, annule: boolean): StatutPaiement {
  if (annule) return "ANNULE";
  const total = totalEncaisse instanceof EncDecimal ? totalEncaisse : montant(totalEncaisse as MontantEntree);
  const S = primeTtc instanceof EncDecimal ? primeTtc : montant(primeTtc as MontantEntree);
  if (total.lte(0)) return "NON_PAYE";
  if (total.lt(S)) return "PARTIELLEMENT_PAYE";
  if (total.eq(S)) return "TOTALEMENT_PAYE";
  return "TROP_PERCU";
}

export type TypeAnnulation = "SANS_EFFET" | "RESILIATION" | "NON_PAIEMENT";

export interface EffetAnnulation {
  primeAcquise: Montant;
  /** Remboursement au client (ristourne pour une résiliation). */
  remboursement: Montant;
  /** Restant dû après annulation (résiliation : prime acquise − encaissé si positif). */
  restantDu: Montant;
}

/** Prime acquise et effets d'une annulation (§5.7 ; les régularisations de taxes, commissions et honoraires viennent au Lot 4). */
export function calculerEffetAnnulation(
  type: TypeAnnulation,
  p: { primeTtc: MontantEntree; encaisse: MontantEntree; dateEffet: Date; dateEcheance: Date; dateAnnulation: Date }
): EffetAnnulation {
  const S = montant(p.primeTtc);
  const encaisse = montant(p.encaisse);
  if (type === "SANS_EFFET") return { primeAcquise: ZERO, remboursement: encaisse, restantDu: ZERO };
  if (type === "NON_PAIEMENT") return { primeAcquise: encaisse, remboursement: ZERO, restantDu: ZERO };
  const ddf = calculerDdf(p.dateEffet, p.dateEcheance);
  if (ddf === 0) throw new EncCalculError("DATES_INVALIDES", "Résiliation impossible : durée du contrat nulle (DDF = 0).");
  const joursCouverts = Math.min(Math.max(ecartJours(p.dateEffet, p.dateAnnulation), 0), ddf);
  const primeAcquise = arrondirCentime(S.times(joursCouverts).dividedBy(ddf));
  const ecart = encaisse.minus(primeAcquise);
  return {
    primeAcquise,
    remboursement: ecart.gt(0) ? ecart : ZERO,
    restantDu: ecart.lt(0) ? ecart.negated() : ZERO,
  };
}

export interface SituationNature {
  du: Montant;
  paye: Montant;
  restantAPayer: Montant;
  nonAcquis: Montant;
  aRecuperer: Montant;
}

/** Dû / payé / restant / non acquis / à récupérer pour une nature (commission, honoraires, accessoires) d'un contrat (§5.5). */
export function situationNature(totalContrat: MontantEntree | Montant, dusParVersement: Montant[], paye: MontantEntree | Montant): SituationNature {
  const total = totalContrat instanceof EncDecimal ? totalContrat : montant(totalContrat as MontantEntree);
  const payeD = paye instanceof EncDecimal ? paye : montant(paye as MontantEntree);
  const du = somme(dusParVersement);
  const ecart = du.minus(payeD);
  return {
    du,
    paye: payeD,
    restantAPayer: ecart.gt(0) ? ecart : ZERO,
    nonAcquis: total.minus(du),
    aRecuperer: ecart.lt(0) ? ecart.negated() : ZERO,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Échéancier prévu (F8)
// ---------------------------------------------------------------------------------------------------------------

export interface EcheancePrevue {
  numero: number;
  date: Date;
  montant: Montant;
}

/**
 * « Répartir en N échéances mensuelles » à partir de la date d'effet : montants tronqués au centime, reliquat sur la
 * dernière (troncature plutôt qu'arrondi : la dernière échéance ne peut jamais devenir négative). Le jour de la
 * date d'effet est conservé, ramené au dernier jour du mois s'il n'existe pas (31/01 → 28/02 → 31/03).
 */
export function repartirEnEcheances(primeTtc: MontantEntree, nombre: number, dateEffet: Date): EcheancePrevue[] {
  if (!Number.isInteger(nombre) || nombre < 1) {
    throw new EncCalculError("PARAMETRE_INVALIDE", "Le nombre d'échéances doit être un entier supérieur ou égal à 1.");
  }
  const S = arrondirCentime(primeTtc);
  if (S.lte(0)) throw new EncCalculError("PRIME_INVALIDE", "La prime TTC doit être supérieure à 0.");
  const part = S.dividedBy(nombre).toDecimalPlaces(2, EncDecimal.ROUND_DOWN);
  const jourAncre = dateEffet.getUTCDate();
  return Array.from({ length: nombre }, (_, i) => ({
    numero: i + 1,
    date: ajouterMois(dateEffet, i, jourAncre),
    montant: i === nombre - 1 ? S.minus(part.times(nombre - 1)) : part,
  }));
}
