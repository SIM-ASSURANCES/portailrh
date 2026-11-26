import type { EtatBaseEcheance } from "./cptEcheancier";
import {
  conventionEnVigueurCpt,
  NATURES_REMUNERATION_CPT,
  type BaseConventionCpt,
  type ConventionLigne,
  type FaitGenerateurCpt,
  type ModeReglementCpt,
  type NatureRemunerationCpt,
} from "./cptReferentiels";

// Aucun import d'`enc*` ou de `treso*` (règle d'indépendance du module : le calcul d'honoraires d'Encaissements n'est pas réutilisé).

/**
 * Moteur de la rémunération des partenaires — lot GC-9b, docs/PLAN_GESTION_COMPTA.md §7.4 et conception §6.4. PUR : aucun accès
 * base, aucune horloge ; montants en centimes entiers (bigint), dates en texte AAAA-MM-JJ, taux en fraction texte (« 0.100000 »).
 *
 * Une ligne = (contrat, échéance, bénéficiaire, nature). Pour chacune :
 *  - dû = base de la convention × taux, arrondi à l'unité (D4), le reliquat exact allant à la dernière échéance ;
 *  - exigible selon le fait générateur : à l'ÉMISSION, tout le dû ; à l'ENCAISSEMENT, au prorata de ce qui est encaissé ;
 *  - payable aujourd'hui = dû × part encaissée de la prime si « au prorata », sinon l'exigible ;
 *  - payé = affectations de règlements et de compensations ; reste payable, reste dû et avance en découlent.
 * L'encaissé d'une échéance est `montantRegle`, tenu par les seuls rattachements VALIDÉS (RG-01) : jamais un second calcul.
 * La convention retenue est celle de `conventionEnVigueurCpt` : aucune convention qui s'applique = aucune ligne, jamais devinée.
 */

const ZERO = BigInt(0);
const DEUX = BigInt(2);
const CENT = BigInt(100);
const MILLION = BigInt(1000000);

const max0 = (x: bigint) => (x > ZERO ? x : ZERO);
const minimum = (a: bigint, b: bigint) => (a < b ? a : b);
const maximum = (a: bigint, b: bigint) => (a > b ? a : b);

/** numérateur ÷ dénominateur (positifs), arrondi à l'UNITÉ FCFA (100 centimes), demi vers le haut. */
function arrondiUnite(numerateur: bigint, denominateur: bigint): bigint {
  return ((numerateur * DEUX + denominateur * CENT) / (denominateur * CENT * DEUX)) * CENT;
}

/** « 0.100000 » → 100000 millionièmes ; accepte 0 à 1 inclus ; `null` sinon. */
export function tauxRemunerationEnMillioniemesCpt(taux: string): bigint | null {
  const m = /^([01])(?:\.(\d{1,6}))?$/.exec(taux.trim());
  if (!m) return null;
  const valeur = BigInt(m[1]) * MILLION + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
  return valeur <= MILLION ? valeur : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------------------------------------------------

export interface ConventionRemunerationCpt extends ConventionLigne {
  taux: string;
  base: BaseConventionCpt;
  faitGenerateur: FaitGenerateurCpt;
  modeReglement: ModeReglementCpt;
  /** `null` = le partenaire de la convention lui-même. */
  beneficiaireId: string | null;
}

export interface EcheanceRemunerationCpt {
  id: string;
  rang: number;
  datePrevue: string;
  etat: EtatBaseEcheance;
  primeHt: bigint;
  accessoires: bigint;
  primeTtc: bigint;
  montantDu: bigint;
  /** Encaissé prouvé : somme des rattachements VALIDÉS (tenue à la validation). */
  montantRegle: bigint;
}

export interface ContratRemunerationCpt {
  id: string;
  numPolice: string;
  statut: string;
  produitCode: string;
  /** `null` = apporté par SIM. */
  apporteurId: string | null;
  dateEffet: string;
  echeances: readonly EcheanceRemunerationCpt[];
}

/** Ligne déjà enregistrée (créée au premier règlement) : sa convention et son dû sont FIGÉS. */
export interface LigneEnregistreeCpt {
  id: string;
  contratId: string;
  echeanceId: string;
  beneficiaireId: string;
  nature: NatureRemunerationCpt;
  conventionId: string;
  du: bigint;
  /** Σ affectations des règlements et des compensations (signées). */
  paye: bigint;
  /** Part payée par des règlements décidés « en une fois » : considérée payable, jamais comme une avance (plafonnée à l'exigible). */
  payeEnUneFois: bigint;
}

/**
 * Part d'une ligne payée « en une fois » : tout ce que les règlements ont versé jusqu'au dernier règlement décidé « en une fois »
 * compris (ce qui avait été payé avant est alors couvert par la même décision). `creeAt` : texte ISO, ordre chronologique.
 */
export function payeDecideEnUneFoisCpt(affectations: readonly { montant: bigint; derogation: ModeReglementCpt | null; creeAt: string }[]): bigint {
  let cumul = ZERO;
  let decide = ZERO;
  for (const a of [...affectations].sort((x, y) => x.creeAt.localeCompare(y.creeAt))) {
    cumul += a.montant;
    if (a.derogation === "EN_UNE_FOIS") decide = cumul;
  }
  return decide;
}

/** Décision du RFCRH « en une fois / au prorata » sur un contrat, pour un bénéficiaire et une nature. */
export interface DecisionModeCpt {
  contratId: string;
  beneficiaireId: string;
  nature: NatureRemunerationCpt;
  mode: ModeReglementCpt;
  /** Texte ISO complet (ordre chronologique par comparaison de chaînes). */
  decideAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Conventions applicables (C-31)
// ---------------------------------------------------------------------------------------------------------------------

export const beneficiaireConventionCpt = (c: Pick<ConventionRemunerationCpt, "partenaireId" | "beneficiaireId">): string => c.beneficiaireId ?? c.partenaireId;

/**
 * Une convention de commission ou d'accessoires reversés sans apporteur désigné ne vaut que pour les contrats apportés par le
 * partenaire lui-même (sinon tout courtier serait payé sur tous les contrats). Les honoraires de gestion, eux, portent sur les
 * contrats gérés, quel que soit l'apporteur (SIM, un autre, ou le gestionnaire). Une convention qui désigne un apporteur est
 * filtrée par `conventionEnVigueurCpt`.
 */
export function conventionConcerneContratCpt(c: ConventionRemunerationCpt, contrat: Pick<ContratRemunerationCpt, "apporteurId">): boolean {
  if (c.nature === "HONORAIRES" || c.apporteurId !== null) return true;
  return contrat.apporteurId === c.partenaireId;
}

export interface ConflitConventionCpt {
  contratId: string;
  numPolice: string;
  beneficiaireId: string;
  nature: NatureRemunerationCpt;
  conventionIds: string[];
}

/**
 * Pour chaque (partenaire, nature), la convention en vigueur à la date d'effet du contrat (`conventionEnVigueurCpt`). Si deux
 * conventions désignent le même bénéficiaire pour la même nature, AUCUNE n'est retenue (conflit signalé, jamais deviné).
 */
export function conventionsApplicablesCpt(
  conventions: readonly ConventionRemunerationCpt[],
  contrat: ContratRemunerationCpt,
): { retenues: ConventionRemunerationCpt[]; conflits: ConflitConventionCpt[] } {
  const parPartenaireNature = new Map<string, ConventionRemunerationCpt[]>();
  for (const c of conventions) {
    if (!conventionConcerneContratCpt(c, contrat)) continue;
    const cle = `${c.partenaireId}|${c.nature}`;
    parPartenaireNature.set(cle, [...(parPartenaireNature.get(cle) ?? []), c]);
  }
  const parBeneficiaireNature = new Map<string, ConventionRemunerationCpt[]>();
  for (const groupe of parPartenaireNature.values()) {
    const retenue = conventionEnVigueurCpt(groupe, {
      partenaireId: groupe[0].partenaireId,
      nature: groupe[0].nature,
      produitCode: contrat.produitCode,
      apporteurId: contrat.apporteurId,
      date: contrat.dateEffet,
    });
    if (!retenue) continue;
    const cle = `${beneficiaireConventionCpt(retenue)}|${retenue.nature}`;
    parBeneficiaireNature.set(cle, [...(parBeneficiaireNature.get(cle) ?? []), retenue]);
  }
  const retenues: ConventionRemunerationCpt[] = [];
  const conflits: ConflitConventionCpt[] = [];
  for (const groupe of parBeneficiaireNature.values()) {
    if (groupe.length === 1) retenues.push(groupe[0]);
    else
      conflits.push({
        contratId: contrat.id,
        numPolice: contrat.numPolice,
        beneficiaireId: beneficiaireConventionCpt(groupe[0]),
        nature: groupe[0].nature,
        conventionIds: groupe.map((c) => c.id).sort(),
      });
  }
  return { retenues, conflits };
}

// ---------------------------------------------------------------------------------------------------------------------
// Dû et parts
// ---------------------------------------------------------------------------------------------------------------------

export function baseEcheanceCpt(e: Pick<EcheanceRemunerationCpt, "primeHt" | "accessoires" | "primeTtc">, base: BaseConventionCpt): bigint {
  if (base === "TTC") return e.primeTtc;
  return base === "NETTE_PLUS_ACCESSOIRES" ? e.primeHt + e.accessoires : e.primeHt;
}

/**
 * Dû initial de chaque échéance (dans l'ordre donné, toutes échéances comprises) : le total du contrat = base totale × taux
 * arrondi à l'unité ; chaque échéance reçoit la différence de deux cumuls arrondis, la dernière le reliquat exact. `null` si le
 * taux est invalide.
 */
export function dusInitiauxCpt(echeances: readonly EcheanceRemunerationCpt[], taux: string, base: BaseConventionCpt): bigint[] | null {
  const t = tauxRemunerationEnMillioniemesCpt(taux);
  if (t === null) return null;
  const bases = echeances.map((e) => max0(baseEcheanceCpt(e, base)));
  const baseTotale = bases.reduce((s, b) => s + b, ZERO);
  if (baseTotale === ZERO) return bases.map(() => ZERO);
  const total = arrondiUnite(baseTotale * t, MILLION);
  let cumulBase = ZERO;
  let attribue = ZERO;
  return bases.map((b, i) => {
    cumulBase += b;
    const cible = i === bases.length - 1 ? total : minimum(total, arrondiUnite(total * cumulBase, baseTotale));
    const part = cible - attribue;
    attribue = cible;
    return part;
  });
}

/** Part d'un montant correspondant à ce qui est encaissé d'une échéance : tout quand elle est soldée, rien sans encaissement. */
export function partEncaisseeCpt(montant: bigint, echeance: Pick<EcheanceRemunerationCpt, "montantDu" | "montantRegle">): bigint {
  if (montant <= ZERO || echeance.montantRegle <= ZERO || echeance.montantDu <= ZERO) return ZERO;
  if (echeance.montantRegle >= echeance.montantDu) return montant;
  return minimum(montant, arrondiUnite(montant * echeance.montantRegle, echeance.montantDu));
}

/** Prime qui ne sera plus encaissée : échéance annulée, ou contrat annulé ou résilié. */
export function primeAbandonneeCpt(contrat: Pick<ContratRemunerationCpt, "statut">, echeance: Pick<EcheanceRemunerationCpt, "etat">): boolean {
  return echeance.etat === "ANNULEE" || contrat.statut === "ANNULE" || contrat.statut === "RESILIE";
}

export interface MontantsLigneCpt {
  /** Dû d'après la convention, avant toute annulation. */
  duInitial: bigint;
  du: bigint;
  exigible: bigint;
  payable: bigint;
  paye: bigint;
  restePayable: bigint;
  resteDu: bigint;
  /** Payé au-delà du payable : versé avant l'encaissement, ou sur une prime finalement abandonnée. */
  avance: bigint;
  /** Dû qui portait sur une prime abandonnée jamais encaissée (à régulariser). */
  aRegulariser: bigint;
}

export function calculerLigneCpt(entree: {
  contrat: Pick<ContratRemunerationCpt, "statut">;
  echeance: Pick<EcheanceRemunerationCpt, "etat" | "montantDu" | "montantRegle">;
  duInitial: bigint;
  faitGenerateur: FaitGenerateurCpt;
  mode: ModeReglementCpt;
  paye: bigint;
  payeEnUneFois?: bigint;
}): MontantsLigneCpt {
  const { contrat, echeance, duInitial, paye } = entree;
  const abandonnee = primeAbandonneeCpt(contrat, echeance);
  // Prime abandonnée : seule la rémunération de la part encaissée reste due.
  const du = abandonnee ? partEncaisseeCpt(duInitial, echeance) : duInitial;
  const exigible = abandonnee || entree.faitGenerateur === "EMISSION" ? du : partEncaisseeCpt(du, echeance);
  const selonRegle = entree.mode === "AU_PRORATA" && !abandonnee ? partEncaisseeCpt(du, echeance) : exigible;
  const payable = maximum(selonRegle, minimum(exigible, entree.payeEnUneFois ?? ZERO));
  return {
    duInitial,
    du,
    exigible,
    payable,
    paye,
    restePayable: max0(payable - paye),
    resteDu: max0(du - paye),
    avance: max0(paye - payable),
    aRegulariser: duInitial - du,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lignes d'un contrat
// ---------------------------------------------------------------------------------------------------------------------

export interface LigneRemunerationCalculeeCpt extends MontantsLigneCpt {
  /** Clé stable : contrat | échéance | bénéficiaire | nature. */
  cle: string;
  /** Identifiant en base ; `null` tant qu'aucun règlement n'a touché ce contrat pour ce bénéficiaire et cette nature. */
  ligneId: string | null;
  contratId: string;
  numPolice: string;
  echeanceId: string;
  rang: number;
  datePrevue: string;
  beneficiaireId: string;
  nature: NatureRemunerationCpt;
  conventionId: string;
  faitGenerateur: FaitGenerateurCpt;
  mode: ModeReglementCpt;
  /** Le mode vient d'une décision du RFCRH, pas de la convention. */
  modeDecide: boolean;
  payeEnUneFois: bigint;
  primeDue: bigint;
  primeEncaissee: bigint;
  primeAbandonnee: boolean;
}

export const cleLigneRemunerationCpt = (contratId: string, echeanceId: string, beneficiaireId: string, nature: NatureRemunerationCpt): string =>
  `${contratId}|${echeanceId}|${beneficiaireId}|${nature}`;

function decisionRetenue(decisions: readonly DecisionModeCpt[], contratId: string, beneficiaireId: string, nature: NatureRemunerationCpt): DecisionModeCpt | null {
  let retenue: DecisionModeCpt | null = null;
  for (const d of decisions) {
    if (d.contratId !== contratId || d.beneficiaireId !== beneficiaireId || d.nature !== nature) continue;
    if (!retenue || d.decideAt > retenue.decideAt) retenue = d;
  }
  return retenue;
}

/**
 * Toutes les lignes de rémunération d'un contrat. Pour un (bénéficiaire, nature) déjà enregistré, la convention et le dû figés
 * priment sur la convention aujourd'hui en vigueur (une convention ajoutée après un règlement ne réécrit rien).
 */
export function lignesContratCpt(entree: {
  contrat: ContratRemunerationCpt;
  conventions: readonly ConventionRemunerationCpt[];
  enregistrees?: readonly LigneEnregistreeCpt[];
  decisions?: readonly DecisionModeCpt[];
}): { lignes: LigneRemunerationCalculeeCpt[]; conflits: ConflitConventionCpt[] } {
  const { contrat, conventions } = entree;
  const enregistrees = (entree.enregistrees ?? []).filter((l) => l.contratId === contrat.id);
  const decisions = entree.decisions ?? [];
  const parId = new Map(conventions.map((c) => [c.id, c]));
  const echeances = [...contrat.echeances].sort((a, b) => a.rang - b.rang);
  const applicables = conventionsApplicablesCpt(conventions, contrat);

  const groupes = new Map<string, { beneficiaireId: string; nature: NatureRemunerationCpt; convention: ConventionRemunerationCpt; figees: Map<string, LigneEnregistreeCpt> }>();
  for (const l of enregistrees) {
    const convention = parId.get(l.conventionId);
    if (!convention) throw new Error(`Convention ${l.conventionId} introuvable pour une ligne de rémunération enregistrée.`);
    const cle = `${l.beneficiaireId}|${l.nature}`;
    const groupe = groupes.get(cle) ?? { beneficiaireId: l.beneficiaireId, nature: l.nature, convention, figees: new Map<string, LigneEnregistreeCpt>() };
    groupe.figees.set(l.echeanceId, l);
    groupes.set(cle, groupe);
  }
  for (const convention of applicables.retenues) {
    const beneficiaireId = beneficiaireConventionCpt(convention);
    const cle = `${beneficiaireId}|${convention.nature}`;
    if (!groupes.has(cle)) groupes.set(cle, { beneficiaireId, nature: convention.nature, convention, figees: new Map() });
  }

  const lignes: LigneRemunerationCalculeeCpt[] = [];
  for (const groupe of groupes.values()) {
    const dus = dusInitiauxCpt(echeances, groupe.convention.taux, groupe.convention.base);
    if (!dus) throw new Error(`Taux invalide sur la convention ${groupe.convention.id}.`);
    const decision = decisionRetenue(decisions, contrat.id, groupe.beneficiaireId, groupe.nature);
    const mode = decision?.mode ?? groupe.convention.modeReglement;
    echeances.forEach((echeance, i) => {
      const figee = groupe.figees.get(echeance.id);
      const montants = calculerLigneCpt({
        contrat,
        echeance,
        duInitial: figee ? figee.du : dus[i],
        faitGenerateur: groupe.convention.faitGenerateur,
        mode,
        paye: figee?.paye ?? ZERO,
        payeEnUneFois: figee?.payeEnUneFois ?? ZERO,
      });
      lignes.push({
        ...montants,
        cle: cleLigneRemunerationCpt(contrat.id, echeance.id, groupe.beneficiaireId, groupe.nature),
        ligneId: figee?.id ?? null,
        contratId: contrat.id,
        numPolice: contrat.numPolice,
        echeanceId: echeance.id,
        rang: echeance.rang,
        datePrevue: echeance.datePrevue,
        beneficiaireId: groupe.beneficiaireId,
        nature: groupe.nature,
        conventionId: groupe.convention.id,
        faitGenerateur: groupe.convention.faitGenerateur,
        mode,
        modeDecide: decision !== null,
        payeEnUneFois: figee?.payeEnUneFois ?? ZERO,
        primeDue: echeance.montantDu,
        primeEncaissee: echeance.montantRegle,
        primeAbandonnee: primeAbandonneeCpt(contrat, echeance),
      });
    });
  }
  const conflits = applicables.conflits.filter((c) => !groupes.has(`${c.beneficiaireId}|${c.nature}`));
  return { lignes: trierLignesRemunerationCpt(lignes), conflits };
}

/** Les plus anciennes d'abord : date prévue de l'échéance, puis police, rang et nature. */
export function trierLignesRemunerationCpt<T extends Pick<LigneRemunerationCalculeeCpt, "datePrevue" | "numPolice" | "rang" | "nature" | "beneficiaireId">>(lignes: readonly T[]): T[] {
  return [...lignes].sort(
    (a, b) =>
      a.datePrevue.localeCompare(b.datePrevue) ||
      a.numPolice.localeCompare(b.numPolice) ||
      a.rang - b.rang ||
      a.nature.localeCompare(b.nature) ||
      a.beneficiaireId.localeCompare(b.beneficiaireId),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Soldes par nature : jamais de compensation entre natures
// ---------------------------------------------------------------------------------------------------------------------

export interface SoldeNatureCpt extends MontantsLigneCpt {
  nature: NatureRemunerationCpt;
  /** Net à verser aujourd'hui DANS la nature : payable − payé, jamais négatif. */
  montantReglable: bigint;
  /** Net versé au-delà du payable DANS la nature : seul montant disponible pour une compensation. */
  avanceNette: bigint;
  /** Maximum d'un règlement avec avance : dû − payé, jamais négatif. */
  plafondAvecAvance: bigint;
}

export function soldeNatureCpt(nature: NatureRemunerationCpt, lignes: readonly (MontantsLigneCpt & { nature: NatureRemunerationCpt })[]): SoldeNatureCpt {
  const s: MontantsLigneCpt = { duInitial: ZERO, du: ZERO, exigible: ZERO, payable: ZERO, paye: ZERO, restePayable: ZERO, resteDu: ZERO, avance: ZERO, aRegulariser: ZERO };
  for (const l of lignes) {
    if (l.nature !== nature) continue;
    s.duInitial += l.duInitial;
    s.du += l.du;
    s.exigible += l.exigible;
    s.payable += l.payable;
    s.paye += l.paye;
    s.restePayable += l.restePayable;
    s.resteDu += l.resteDu;
    s.avance += l.avance;
    s.aRegulariser += l.aRegulariser;
  }
  return { ...s, nature, montantReglable: max0(s.payable - s.paye), avanceNette: max0(s.paye - s.payable), plafondAvecAvance: max0(s.du - s.paye) };
}

/** Les trois soldes de rémunération d'un partenaire, TOUJOURS séparés (le quatrième, sa créance, vient de `cptCreances.ts`). */
export function soldesParNatureCpt(lignes: readonly (MontantsLigneCpt & { nature: NatureRemunerationCpt })[]): Record<NatureRemunerationCpt, SoldeNatureCpt> {
  return Object.fromEntries(NATURES_REMUNERATION_CPT.map((n) => [n, soldeNatureCpt(n, lignes)])) as Record<NatureRemunerationCpt, SoldeNatureCpt>;
}
