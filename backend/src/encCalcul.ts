import DecimalJs from "decimal.js";

/**
 * Moteur de calcul PUR du module « Encaissements, taxes » (docs/encaissements-conception.md §7 ; cahier des charges
 * V2.6, §5 « Règles de calcul »). Aucun accès à la base, aucune date système implicite, aucun paramètre en dur : le jour
 * limite de reversement et les taux de partage des accessoires sont des arguments (ils viennent d'EncParametre, des
 * partenaires et des polices).
 *
 * Décimal : clone LOCAL de decimal.js (arrondi half-up), jamais `Decimal.set` global qui modifierait la
 * configuration partagée. Aucun `Number()` sur un montant : les entrées sont des chaînes ou des objets
 * « Decimal.js-like » (dont `Prisma.Decimal`), convertis par `toFixed()` (exact, sans notation exponentielle).
 * Les sorties sont des instances decimal.js, acceptées telles quelles par Prisma en écriture. Calcul et stockage au
 * centime ; l'affichage arrondi à l'unité FCFA se fait à l'écran (arbitrage D3 du 2026-09-28).
 *
 * Dates : jours calendaires lus en UTC (un champ Prisma `@db.Date` arrive à minuit UTC). Construire les dates avec
 * `jourCalendaire(a, m, j)`.
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

function versMontant(valeur: MontantEntree | Montant): Montant {
  return valeur instanceof EncDecimal ? valeur : montant(valeur as MontantEntree);
}

const ZERO = new EncDecimal(0);

/** Arrondi au centime, half-up (0,005 → 0,01 ; −0,005 → −0,01, arrondi « à l'écart de zéro » de decimal.js). */
export function arrondirCentime(valeur: MontantEntree | Montant): Montant {
  return versMontant(valeur).toDecimalPlaces(2, EncDecimal.ROUND_HALF_UP);
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

function premierInstant(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function premierDuMois(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** 1er du mois `n` mois plus tard (le mois de départ est ramené à son 1er jour). */
function moisSuivant(date: Date, n = 1): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

function ecartJours(debut: Date, fin: Date): number {
  return Math.round((premierInstant(fin) - premierInstant(debut)) / MS_PAR_JOUR);
}

// ---------------------------------------------------------------------------------------------------------------
// Prorata d'un encaissement (§5.2) — règle d'arrondi D3 (définitive le 2026-09-28)
// ---------------------------------------------------------------------------------------------------------------

/** Montants d'un contrat, tels que fournis par le fichier de production : S prime TTC, T prime nette, U accessoires,
 *  V taxes, W commission, X honoraires. Jamais recalculés (CDC principe 1). */
export interface MontantsContrat {
  S: Montant;
  T: Montant;
  U: Montant;
  V: Montant;
  W: Montant;
  X: Montant;
}

/** Cumul des encaissements CONFIRMÉS précédents du contrat, dans l'ordre de prise en compte (contre-passations
 *  incluses, avec leur signe). */
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
  /** Restant dû après cet encaissement ; négatif en cas de trop-perçu. */
  AA: Montant;
  /** L'encaissement solde le contrat (il reçoit le reliquat exact de chaque élément). */
  estSoldant: boolean;
  /** Part de Z au-delà du restant dû (ALERTE : la décision revient à l'appelant, CDC §5.6) ; null sinon. */
  tropPercu: Montant | null;
}

export type RegleVentilation = (contrat: MontantsContrat, cumul: CumulVersements, Z: Montant, estSoldant: boolean) => VentilationVersement;

/**
 * RÈGLE D'ARRONDI (arbitrage A7 du 2026-09-26, rendu définitif par D3 le 2026-09-28) :
 * - non soldant : AB et AC arrondis half-up, AD = Z − AB − AC, commission et honoraires arrondis indépendamment ;
 * - soldant : reliquat exact de chaque élément (total du contrat − cumul). Si T + U + V ≠ S, la taxe totale encaissée
 *   reste celle du fichier (ΣAD = V) et la ventilation du soldant peut s'écarter de Z de quelques francs (CDC §5.2).
 */
export const regleArrondi: RegleVentilation = (contrat, cumul, Z, estSoldant) => {
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

const VENTILATION_NULLE: VentilationVersement = { AB: ZERO, AC: ZERO, AD: ZERO, commission: ZERO, honoraires: ZERO };

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

/**
 * Calcule un encaissement positif à partir des montants du contrat EN VIGUEUR (un avenant les a peut-être modifiés :
 * les encaissements déjà confirmés restent figés, celui-ci utilise les nouveaux montants et le soldant reçoit le reliquat
 * sur les nouveaux totaux — D8).
 *
 * Trop-perçu (Z au-delà du restant dû) : n'est plus refusé ; `tropPercu` renvoie l'excédent comme ALERTE, la Finance
 * décide (CDC §5.6). Ventilation retenue en attendant le client (ambiguïté V2-A6, provisoire) : l'encaissement solde le
 * contrat et reçoit les reliquats exacts ; l'excédent n'est ventilé sur aucun élément (aucune taxe sur une somme qui
 * n'est pas une prime). Si le contrat était déjà soldé (restant ≤ 0, par exemple après un avenant à la baisse), tout Z
 * est excédent et aucun élément n'est ventilé.
 */
export function calculerVersement(
  contrat: MontantsContrat,
  cumul: CumulVersements,
  montantRecu: MontantEntree | Montant,
  regle: RegleVentilation = regleArrondi
): VersementCalcule {
  const Z = arrondirCentime(montantRecu);
  if (Z.lte(0)) throw new EncCalculError("MONTANT_INVALIDE", "Le montant reçu doit être supérieur à 0.");
  const restantAvant = contrat.S.minus(cumul.Z);
  const AA = restantAvant.minus(Z);
  if (restantAvant.lte(0)) {
    return { Z, AA, estSoldant: false, tropPercu: Z, ...VENTILATION_NULLE };
  }
  const estSoldant = Z.gte(restantAvant);
  return { Z, AA, estSoldant, tropPercu: AA.lt(0) ? AA.negated() : null, ...regle(contrat, cumul, Z, estSoldant) };
}

// ---------------------------------------------------------------------------------------------------------------
// Exigibilité de la taxe (§5.3)
// ---------------------------------------------------------------------------------------------------------------

export interface ParametresExigibilite {
  /** Jour limite de reversement dans le mois d'exigibilité : 20 par défaut, 1 à 28 (CDC §3.6). */
  jourLimite: number;
}

export interface Exigibilite {
  moisPaiement: Date;
  moisExigibilite: Date;
  dateLimite: Date;
  /** Le mois retenu dépasse (mois de paiement + 1) : taxe reportée, mention « Régularisation » (CDC §5.3). */
  estRegularisation: boolean;
}

function verifierJourLimite(jourLimite: number) {
  if (!Number.isInteger(jourLimite) || jourLimite < 1 || jourLimite > 28) {
    throw new EncCalculError("PARAMETRE_INVALIDE", "Le jour limite de reversement doit être un entier entre 1 et 28.");
  }
}

/**
 * Mois d'exigibilité = le plus tardif de : (mois de paiement + 1) et (mois de prise en compte, ou mois suivant si la
 * prise en compte a lieu le jour limite ou après). La prise en compte est la date de saisie (manuelle), de confirmation
 * (fichier) ou d'affectation (argent non identifié). À reverser avant le jour limite du mois d'exigibilité.
 */
export function calculerExigibilite(datePaiement: Date, datePriseEnCompte: Date, params: ParametresExigibilite): Exigibilite {
  verifierJourLimite(params.jourLimite);
  if (premierInstant(datePriseEnCompte) < premierInstant(datePaiement)) {
    throw new EncCalculError("DATES_INVALIDES", "La date de prise en compte ne peut pas précéder la date de paiement.");
  }
  const moisPaiement = premierDuMois(datePaiement);
  const normal = moisSuivant(moisPaiement);
  const selonPriseEnCompte =
    datePriseEnCompte.getUTCDate() < params.jourLimite ? premierDuMois(datePriseEnCompte) : moisSuivant(datePriseEnCompte);
  const moisExigibilite = selonPriseEnCompte > normal ? selonPriseEnCompte : normal;
  return {
    moisPaiement,
    moisExigibilite,
    dateLimite: new Date(Date.UTC(moisExigibilite.getUTCFullYear(), moisExigibilite.getUTCMonth(), params.jourLimite)),
    estRegularisation: moisExigibilite > normal,
  };
}

/** Reprise initiale (CDC F1.5) : la prise en compte est la date de paiement réelle ; jamais de « Régularisation ». */
export function calculerExigibiliteReprise(datePaiement: Date, params: ParametresExigibilite): Exigibilite {
  return calculerExigibilite(datePaiement, datePaiement, params);
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
// Partage des accessoires (§5.4)
// ---------------------------------------------------------------------------------------------------------------

export type SourceTauxAccessoires = "POLICE" | "PARTENAIRE" | "DEFAUT";

export interface TauxAccessoires {
  /** Part du PARTENAIRE, en fraction (0,4 pour 40 %) ; la part SIM est le complément. */
  taux: Montant;
  source: SourceTauxAccessoires;
}

function verifierTaux(taux: Montant, quoi: string): Montant {
  if (taux.lt(0) || taux.gt(1)) {
    throw new EncCalculError("TAUX_INVALIDE", `Part partenaire des accessoires (${quoi}) : fraction entre 0 et 1 attendue.`);
  }
  return taux;
}

/** Taux retenu, dans l'ordre : celui de la police, sinon celui du partenaire, sinon le taux par défaut. */
export function choisirTauxAccessoires(p: {
  police?: MontantEntree | Montant | null;
  partenaire?: MontantEntree | Montant | null;
  defaut: MontantEntree | Montant;
}): TauxAccessoires {
  if (p.police !== undefined && p.police !== null) return { taux: verifierTaux(versMontant(p.police), "police"), source: "POLICE" };
  if (p.partenaire !== undefined && p.partenaire !== null) {
    return { taux: verifierTaux(versMontant(p.partenaire), "partenaire"), source: "PARTENAIRE" };
  }
  return { taux: verifierTaux(versMontant(p.defaut), "défaut"), source: "DEFAUT" };
}

export interface PartageAccessoires {
  taux: Montant;
  partPartenaire: Montant;
  partSim: Montant;
}

/** Découpe AC : part partenaire arrondie au centime (half-up), part SIM = AC − part partenaire (la somme vaut AC). */
export function partagerAccessoires(AC: MontantEntree | Montant, taux: MontantEntree | Montant): PartageAccessoires {
  const ac = versMontant(AC);
  const t = verifierTaux(versMontant(taux), "encaissement");
  const partPartenaire = arrondirCentime(ac.times(t));
  return { taux: t, partPartenaire, partSim: ac.minus(partPartenaire) };
}

/**
 * Changement de taux (CDC §5.4) : une part partenaire DÉJÀ PAYÉE n'est jamais modifiée ; une part non payée est
 * recalculée sur le même AC (figé) avec le nouveau taux, si l'utilisateur a choisi de l'appliquer aux encaissements déjà
 * enregistrés. La résolution du taux (police > partenaire > défaut) reste à la charge de l'appelant.
 */
export function recalculerPartAccessoires(
  actuel: PartageAccessoires,
  AC: MontantEntree | Montant,
  partPartenairePayee: boolean,
  nouveauTaux: MontantEntree | Montant
): PartageAccessoires {
  if (partPartenairePayee) return actuel;
  return partagerAccessoires(AC, nouveauTaux);
}

// ---------------------------------------------------------------------------------------------------------------
// Encaissement figé à la confirmation, contre-passation (§3.2, F3.5)
// ---------------------------------------------------------------------------------------------------------------

/** Tous les montants figés d'un encaissement confirmé (D9) : ventilation, parts d'accessoires, exigibilité. */
export interface EncaissementFige extends VersementCalcule {
  accessoires: PartageAccessoires;
  exigibilite: Exigibilite;
}

/** Calcule et fige un encaissement à sa confirmation : prorata, partage des accessoires, exigibilité de la taxe. */
export function figerEncaissement(p: {
  contrat: MontantsContrat;
  cumul: CumulVersements;
  montantRecu: MontantEntree | Montant;
  tauxAccessoires: MontantEntree | Montant;
  exigibilite: Exigibilite;
}): EncaissementFige {
  const v = calculerVersement(p.contrat, p.cumul, p.montantRecu);
  return { ...v, accessoires: partagerAccessoires(v.AC, p.tauxAccessoires), exigibilite: p.exigibilite };
}

/**
 * Contre-passation (CDC F3.5) : copie négative EXACTE des montants figés de l'encaissement d'origine (Z, AB, AC, AD,
 * commission, honoraires, parts d'accessoires), sans nouveau calcul au prorata ; elle garde le mois d'exigibilité de
 * l'origine (la taxe est retirée du même mois). `restantDuActuel` = reste dû du contrat avant la contre-passation.
 */
export function contrepasser(original: EncaissementFige, restantDuActuel: MontantEntree | Montant): EncaissementFige {
  return {
    Z: original.Z.negated(),
    AB: original.AB.negated(),
    AC: original.AC.negated(),
    AD: original.AD.negated(),
    commission: original.commission.negated(),
    honoraires: original.honoraires.negated(),
    AA: versMontant(restantDuActuel).plus(original.Z),
    estSoldant: false,
    tropPercu: null,
    accessoires: {
      taux: original.accessoires.taux,
      partPartenaire: original.accessoires.partPartenaire.negated(),
      partSim: original.accessoires.partSim.negated(),
    },
    exigibilite: { ...original.exigibilite },
  };
}

export type NaturePayee = "TAXE" | "COMMISSION" | "HONORAIRES" | "ACCESSOIRES";

/** Natures déjà marquées « payé » sur un encaissement contre-passé ou annulé : à signaler « à régulariser », sans
 *  calcul automatique (CDC F3.5, F8.4). */
export function naturesARegulariser(payees: Partial<Record<NaturePayee, boolean>>): NaturePayee[] {
  return (["TAXE", "COMMISSION", "HONORAIRES", "ACCESSOIRES"] as const).filter((n) => payees[n] === true);
}

// ---------------------------------------------------------------------------------------------------------------
// Statuts, DDF, annulation (§5.6, F8), dû / payé par nature
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

/** Statut de paiement d'une police (CDC §5.6), sur le total des encaissements CONFIRMÉS. */
export function statutPaiement(totalEncaisse: MontantEntree | Montant, primeTtc: MontantEntree | Montant, annule: boolean): StatutPaiement {
  if (annule) return "ANNULE";
  const total = versMontant(totalEncaisse);
  const S = versMontant(primeTtc);
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

/** Prime acquise et effets d'une annulation (CDC F8 ; les signaux « à régulariser » viennent au Lot 4). */
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
  /** Payé au-delà du dû (après une contre-passation ou une annulation) : signalé « à régulariser », sans calcul
   *  automatique de créance (CDC F8.4). */
  aRegulariser: Montant;
}

/** Dû / payé / restant / non acquis / à régulariser pour une nature (commission, honoraires, accessoires) d'un contrat. */
export function situationNature(totalContrat: MontantEntree | Montant, dusParVersement: Montant[], paye: MontantEntree | Montant): SituationNature {
  const total = versMontant(totalContrat);
  const payeD = versMontant(paye);
  const du = somme(dusParVersement);
  const ecart = du.minus(payeD);
  return {
    du,
    paye: payeD,
    restantAPayer: ecart.gt(0) ? ecart : ZERO,
    nonAcquis: total.minus(du),
    aRegulariser: ecart.lt(0) ? ecart.negated() : ZERO,
  };
}
